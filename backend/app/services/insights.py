"""Dashboard, trend and streak computation, straight from food_logs.

This replaces the seed snapshot the scaffold shipped with. Two things matter
here and neither is obvious:

Days are the user's local days, not UTC ones. `created_at` is a timestamptz, so
`timezone(tz, created_at)` converts it to wall-clock time in the user's zone
before the date is taken. In Karachi a UTC day rolls over at 5am local, so
bucketing by UTC would push an 11:30pm biryani onto the following day and make
both the calorie chart and the streak wrong in a way nobody would think to
question.

Streaks are recomputed on every request rather than stored. That is deliberate:
a stored streak is a second source of truth that drifts the moment a log is
edited, deleted or backfilled. The query returns only the days that contain a
junk flagged log, which is a small set even for a heavy user, and the run length
arithmetic happens here.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BurnLog, FoodCategory, FoodLog, Restaurant, User
from app.schemas.insights import (
    BurnEquivalents,
    CaloriesByDay,
    DashboardOut,
    FunMeal,
    ReminderSignalOut,
    StreaksOut,
    TodayOut,
    TopCategory,
    TopRestaurant,
    TrendChange,
    TrendOut,
    TrendPeriod,
)

# Roughly how many kcal a 70kg adult burns per minute, from standard MET values.
# Rough on purpose: the burn row is an intuition pump, not a prescription.
KCAL_PER_MINUTE = {"walking": 4.4, "running": 11.7, "cycling": 8.2}

# How much of the calorie chart to return. Two weeks is what fits on a phone
# without the bars becoming hairlines.
CHART_DAYS = 14

# How far back to look when hunting for the longest streak. Without a bound this
# would walk every day since the account was created.
STREAK_WINDOW_DAYS = 365


def _local_day(user: User):
    """The log's calendar date in the user's own timezone, as SQL."""
    return cast(func.timezone(user.timezone, FoodLog.created_at), Date)


def _local_bounds(
    user: User, start_date: dt.date, end_date: dt.date
) -> tuple[dt.datetime, dt.datetime]:
    tz = ZoneInfo(user.timezone)
    start = dt.datetime.combine(start_date, dt.time.min, tzinfo=tz).astimezone(dt.UTC)
    end = dt.datetime.combine(end_date, dt.time.min, tzinfo=tz).astimezone(dt.UTC)
    return start, end


def today_for(user: User) -> dt.date:
    """The user's own calendar day, in Python.

    The same rule _local_day applies in SQL. Using the server's date instead
    would file an evening entry in Karachi under the previous day, which is the
    exact bug the per-user timezone exists to avoid.
    """
    return dt.datetime.now(ZoneInfo(user.timezone)).date()


async def build_dashboard(session: AsyncSession, user: User) -> DashboardOut:
    totals = (
        await session.execute(
            select(
                func.count(FoodLog.id),
                func.coalesce(func.sum(FoodLog.estimated_calories), 0),
                func.coalesce(
                    func.sum(case((FoodCategory.is_junk, 1), else_=0)),
                    0,
                ),
            )
            .select_from(FoodLog)
            .join(FoodCategory, FoodCategory.id == FoodLog.category_id)
            .where(FoodLog.user_id == user.id)
        )
    ).one()
    logs_count, total_calories, junk_count = int(totals[0]), int(totals[1]), int(totals[2])

    # Read before the early return below. Someone can record a walk on a day
    # they have not logged any food, and returning zero for it because there
    # happens to be no meal would hide the only thing they entered.
    total_burned = int(
        await session.scalar(
            select(func.coalesce(func.sum(BurnLog.calories), 0)).where(BurnLog.user_id == user.id)
        )
        or 0
    )

    today = dt.datetime.now(ZoneInfo(user.timezone)).date()
    window_start = today - dt.timedelta(days=CHART_DAYS - 1)
    window_start_utc, window_end_utc = _local_bounds(
        user, window_start, today + dt.timedelta(days=1)
    )

    if logs_count == 0 and total_burned == 0:
        return DashboardOut(
            junk_ratio=0.0,
            total_calories=0,
            total_burned=0,
            net_calories=0,
            logs_count=0,
            calories_by_day=[],
            top_category=None,
            top_restaurant=None,
            best_fun_meals=[],
            burn_equivalents=BurnEquivalents(
                walking_minutes=0, running_minutes=0, cycling_minutes=0
            ),
            # Named rather than left to default. TodayOut() leaves target null,
            # which told an account that had set a daily target and not yet
            # logged anything that it had no target at all. Nothing on the
            # dashboard shows it today, because the screen happens to hide that
            # block behind the same condition as this early return, but the
            # payload was already wrong and the next reader of it would have
            # inherited the bug rather than found it.
            today=TodayOut(
                target=user.daily_calorie_target,
                consumed=0,
                burned=0,
                net=0,
                # Nothing eaten and nothing burned, so the whole target is left.
                remaining=user.daily_calorie_target,
            ),
        )

    # The day expression goes in a subquery so the outer GROUP BY references a
    # real column. Grouping by the expression directly does not work: the
    # timezone name is a bind parameter, so the copy in SELECT and the copy in
    # GROUP BY compile to different placeholders and PostgreSQL refuses to treat
    # them as the same expression.
    daily = (
        select(
            _local_day(user).label("day"),
            FoodLog.estimated_calories.label("calories"),
            # Carried through the subquery so the junk split is one pass over the
            # same rows rather than a second trip to the database.
            case((FoodCategory.is_junk, FoodLog.estimated_calories), else_=0).label("junk"),
        )
        .join(FoodCategory, FoodCategory.id == FoodLog.category_id)
        .where(
            FoodLog.user_id == user.id,
            FoodLog.created_at >= window_start_utc,
            FoodLog.created_at < window_end_utc,
        )
        .subquery()
    )
    day_rows = (
        await session.execute(
            select(
                daily.c.day,
                func.sum(daily.c.calories).label("calories"),
                func.sum(daily.c.junk).label("junk"),
            ).group_by(daily.c.day)
        )
    ).all()
    by_day = {row.day: int(row.calories) for row in day_rows}
    junk_by_day = {row.day: int(row.junk or 0) for row in day_rows}

    burned_rows = (
        await session.execute(
            select(BurnLog.day, BurnLog.calories).where(
                BurnLog.user_id == user.id, BurnLog.day >= window_start
            )
        )
    ).all()
    burned_by_day = {row.day: int(row.calories) for row in burned_rows}

    # Every day in the window, including the ones with nothing logged. A gap
    # rendered as a missing bar reads as an app failure; a zero reads as a day
    # that was not logged.
    calories_by_day = [
        CaloriesByDay(
            day=window_start + dt.timedelta(days=offset),
            calories=by_day.get(window_start + dt.timedelta(days=offset), 0),
            junk_calories=junk_by_day.get(window_start + dt.timedelta(days=offset), 0),
            burned=burned_by_day.get(window_start + dt.timedelta(days=offset), 0),
        )
        for offset in range(CHART_DAYS)
    ]

    top_category_row = (
        await session.execute(
            select(
                FoodCategory.id,
                FoodCategory.name,
                func.count(FoodLog.id).label("count"),
            )
            .join(FoodLog, FoodLog.category_id == FoodCategory.id)
            .where(FoodLog.user_id == user.id)
            .group_by(FoodCategory.id, FoodCategory.name)
            .order_by(func.count(FoodLog.id).desc(), FoodCategory.name)
            .limit(1)
        )
    ).first()

    top_restaurant_row = (
        await session.execute(
            select(
                Restaurant.id,
                Restaurant.name,
                func.count(FoodLog.id).label("count"),
            )
            .join(FoodLog, FoodLog.restaurant_id == Restaurant.id)
            .where(FoodLog.user_id == user.id)
            .group_by(Restaurant.id, Restaurant.name)
            .order_by(func.count(FoodLog.id).desc(), Restaurant.name)
            .limit(1)
        )
    ).first()

    fun_rows = (
        await session.execute(
            select(FoodLog.dish_name, FoodLog.fun_scale, Restaurant.name)
            .outerjoin(Restaurant, Restaurant.id == FoodLog.restaurant_id)
            .where(FoodLog.user_id == user.id, FoodLog.fun_scale.is_not(None))
            .order_by(FoodLog.fun_scale.desc(), FoodLog.created_at.desc())
            .limit(5)
        )
    ).all()

    # The burn row describes an average logged day, not the whole history, which
    # would be a meaningless number of hours.
    distinct_days = (
        await session.scalar(
            select(func.count(func.distinct(_local_day(user)))).where(FoodLog.user_id == user.id)
        )
    ) or 1
    average_day = total_calories / distinct_days

    # Today on its own. The chart is a 14 day window and its shape is free to
    # change; a progress bar is a claim about today, so it is computed from the
    # user's own current date rather than read off the end of that list.
    today_local = today_for(user)
    today_row = next((d for d in calories_by_day if d.day == today_local), None)
    consumed = today_row.calories if today_row else 0
    burned_today = today_row.burned if today_row else 0
    net_today = consumed - burned_today
    target = user.daily_calorie_target

    return DashboardOut(
        today=TodayOut(
            target=target,
            consumed=consumed,
            burned=burned_today,
            net=net_today,
            remaining=None if target is None else target - net_today,
        ),
        junk_ratio=round(junk_count / logs_count, 4) if logs_count else 0.0,
        total_calories=total_calories,
        total_burned=total_burned,
        # Allowed to go negative. Burning more than you ate is a real day, and
        # clamping it to zero would hide exactly the thing the user logged it for.
        net_calories=total_calories - total_burned,
        logs_count=logs_count,
        calories_by_day=calories_by_day,
        top_category=(
            TopCategory(
                category_id=top_category_row[0],
                name=top_category_row[1],
                count=int(top_category_row[2]),
            )
            if top_category_row
            else None
        ),
        top_restaurant=(
            TopRestaurant(
                restaurant_id=top_restaurant_row[0],
                name=top_restaurant_row[1],
                count=int(top_restaurant_row[2]),
            )
            if top_restaurant_row
            else None
        ),
        best_fun_meals=[
            FunMeal(dish_name=row[0], fun_scale=row[1], restaurant_name=row[2]) for row in fun_rows
        ],
        burn_equivalents=BurnEquivalents(
            **{
                f"{activity}_minutes": round(average_day / rate)
                for activity, rate in KCAL_PER_MINUTE.items()
            }
        ),
    )


def _streak_message(current: int, has_any_logs: bool) -> str:
    """Soft recovery wording. The brief asks for a diary, not a scolding."""
    if not has_any_logs:
        return "No logs yet. Your first one starts the streak."
    if current == 0:
        return "Streak reset today. No drama, the next log starts a new one."
    if current == 1:
        return "One clean day. Worth protecting."
    if current < 5:
        return f"{current} clean days so far. Worth protecting."
    return f"{current} days without a junk log. Quietly impressive."


async def compute_streaks(session: AsyncSession, user: User) -> StreaksOut:
    today = dt.datetime.now(ZoneInfo(user.timezone)).date()
    window_start = today - dt.timedelta(days=STREAK_WINDOW_DAYS)
    window_start_utc, window_end_utc = _local_bounds(
        user, window_start, today + dt.timedelta(days=1)
    )

    junk_days = set(
        (
            await session.scalars(
                select(func.distinct(_local_day(user)))
                .select_from(FoodLog)
                .join(FoodCategory, FoodCategory.id == FoodLog.category_id)
                .where(
                    FoodLog.user_id == user.id,
                    FoodCategory.is_junk.is_(True),
                    FoodLog.created_at >= window_start_utc,
                    FoodLog.created_at < window_end_utc,
                )
            )
        ).all()
    )

    first_logged_day = await session.scalar(
        select(func.min(_local_day(user))).where(FoodLog.user_id == user.id)
    )

    if first_logged_day is None:
        return StreaksOut(
            current_streak=0,
            longest_streak=0,
            last_junk_date=None,
            message=_streak_message(0, has_any_logs=False),
        )

    earliest = max(first_logged_day, window_start)

    # A streak is a sequence of days without a junk log, not a sequence of days
    # with a clean meal. Empty days still count as clean until the next junk day
    # resets the run.
    current_streak = 0
    cursor = today
    while cursor >= earliest and cursor not in junk_days:
        current_streak += 1
        cursor -= dt.timedelta(days=1)

    longest_streak = 0
    run = 0
    day = earliest
    while day <= today:
        if day not in junk_days:
            run += 1
            longest_streak = max(longest_streak, run)
        else:
            run = 0
        day += dt.timedelta(days=1)

    last_junk_date = max(junk_days) if junk_days else None

    # The dish behind that date, so the screen can name what broke the run
    # rather than only when it broke. Ordered by the log's own timestamp and
    # limited to one: a day can hold several junk meals and the last one is the
    # one that ended the day still broken.
    last_junk_dish = None
    if last_junk_date is not None:
        start_utc, end_utc = _local_bounds(
            user, last_junk_date, last_junk_date + dt.timedelta(days=1)
        )
        last_junk_dish = await session.scalar(
            select(FoodLog.dish_name)
            .join(FoodCategory, FoodCategory.id == FoodLog.category_id)
            .where(
                FoodLog.user_id == user.id,
                FoodCategory.is_junk.is_(True),
                FoodLog.created_at >= start_utc,
                FoodLog.created_at < end_utc,
            )
            .order_by(FoodLog.created_at.desc())
            .limit(1)
        )

    return StreaksOut(
        current_streak=current_streak,
        longest_streak=longest_streak,
        last_junk_date=last_junk_date,
        last_junk_dish=last_junk_dish,
        message=_streak_message(current_streak, has_any_logs=True),
    )


async def build_reminder_signal(
    session: AsyncSession, user: User
) -> ReminderSignalOut:
    streaks = await compute_streaks(session, user)
    now = dt.datetime.now(ZoneInfo(user.timezone))
    today = now.date()
    start_utc, end_utc = _local_bounds(user, today, today + dt.timedelta(days=1))

    logs = list(
        await session.scalars(
            select(FoodLog)
            .where(
                FoodLog.user_id == user.id,
                FoodLog.created_at >= start_utc,
                FoodLog.created_at < end_utc,
            )
            .order_by(FoodLog.created_at)
        )
    )
    slots = set()
    for log in logs:
        hour = log.created_at.astimezone(ZoneInfo(user.timezone)).hour
        if 5 <= hour < 11:
            slots.add("breakfast")
        elif 11 <= hour < 16:
            slots.add("lunch")
        elif 16 <= hour < 24:
            slots.add("dinner")

    latest = await session.scalar(
        select(FoodLog.created_at)
        .where(FoodLog.user_id == user.id)
        .order_by(FoodLog.created_at.desc())
        .limit(1)
    )
    hours_since_last_log = (
        None
        if latest is None
        else max(0, int((now - latest.astimezone(ZoneInfo(user.timezone))).total_seconds() // 3600))
    )

    return ReminderSignalOut(
        hours_since_last_log=hours_since_last_log,
        current_streak=streaks.current_streak,
        todays_meals_logged=[slot for slot in ("breakfast", "lunch", "dinner") if slot in slots],
        is_on_junk_streak=streaks.current_streak == 0 and streaks.last_junk_date == today,
    )


def _month_start(day: dt.date) -> dt.date:
    return day.replace(day=1)


def _previous_month_start(month_start: dt.date) -> dt.date:
    """The first of the month before this one.

    One day back from the first always lands inside the previous month whatever
    its length, so February and the December to January rollover need no special
    case and no per month table.
    """
    return (month_start - dt.timedelta(days=1)).replace(day=1)


def _next_month_start(month_start: dt.date) -> dt.date:
    """The first of the month after this one. Same trick, forwards.

    31 days from the first of any month lands inside the next one, because no
    month is longer than that.
    """
    return (month_start + dt.timedelta(days=31)).replace(day=1)


async def _month_totals(
    session: AsyncSession, user: User, start: dt.date, end: dt.date, days: int
) -> TrendPeriod:
    """Aggregate the half open local day range [start, end) into one period.

    The bounds are compared against the same `_local_day` expression the
    dashboard buckets by, so a meal at half past midnight on the first of the
    month in Karachi belongs to the new month rather than being dragged back
    into the old one by its UTC date.
    """
    start_utc, end_utc = _local_bounds(user, start, end)
    row = (
        await session.execute(
            select(
                func.count(FoodLog.id),
                func.coalesce(func.sum(FoodLog.estimated_calories), 0),
                func.coalesce(func.sum(case((FoodCategory.is_junk, 1), else_=0)), 0),
            )
            .select_from(FoodLog)
            .join(FoodCategory, FoodCategory.id == FoodLog.category_id)
            .where(
                FoodLog.user_id == user.id,
                FoodLog.created_at >= start_utc,
                FoodLog.created_at < end_utc,
            )
        )
    ).one()
    meals, total_calories, junk_count = int(row[0]), int(row[1]), int(row[2])

    # A month with nothing in it is an answer, not an absence. Every field stays
    # a number so the client can draw a flat column and a "down on last month"
    # arrow without a null check on each metric; `days` is never zero, so the
    # average has nothing to guard against either.
    return TrendPeriod(
        month=start,
        total_calories=total_calories,
        meals_logged=meals,
        junk_ratio=round(junk_count / meals, 4) if meals else 0.0,
        avg_calories_per_day=round(total_calories / days, 1),
        days_counted=days,
    )


async def build_trend(session: AsyncSession, user: User) -> TrendOut:
    today = today_for(user)
    this_start = _month_start(today)
    last_start = _previous_month_start(this_start)

    # The current month is averaged over the days that have happened, last month
    # over its full length. Dividing a month that is three days old by 30 would
    # report an average a tenth of the real one and show every user a collapse
    # in intake on the 3rd that reversed itself by the 30th.
    this_month = await _month_totals(
        session,
        user,
        this_start,
        _next_month_start(this_start),
        days=(today - this_start).days + 1,
    )
    last_month = await _month_totals(
        session,
        user,
        last_start,
        this_start,
        days=(this_start - last_start).days,
    )

    return TrendOut(
        this_month=this_month,
        last_month=last_month,
        # Subtracted from the rounded figures above rather than from the raw
        # ones, so the arrow always agrees with the two numbers printed beside
        # it. A client doing this itself would be doing exactly this arithmetic.
        change=TrendChange(
            total_calories=this_month.total_calories - last_month.total_calories,
            meals_logged=this_month.meals_logged - last_month.meals_logged,
            junk_ratio=round(this_month.junk_ratio - last_month.junk_ratio, 4),
            avg_calories_per_day=round(
                this_month.avg_calories_per_day - last_month.avg_calories_per_day, 1
            ),
        ),
    )
