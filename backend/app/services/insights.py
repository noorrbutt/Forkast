"""Dashboard and streak computation, straight from food_logs.

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
    StreaksOut,
    TopCategory,
    TopRestaurant,
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
    """The log's calendar date in the user's own timezone."""
    return cast(func.timezone(user.timezone, FoodLog.created_at), Date)


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
        )
        .where(FoodLog.user_id == user.id, _local_day(user) >= window_start)
        .subquery()
    )
    day_rows = (
        await session.execute(
            select(daily.c.day, func.sum(daily.c.calories).label("calories")).group_by(daily.c.day)
        )
    ).all()
    by_day = {row.day: int(row.calories) for row in day_rows}

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

    return DashboardOut(
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

    junk_days = set(
        (
            await session.scalars(
                select(func.distinct(_local_day(user)))
                .select_from(FoodLog)
                .join(FoodCategory, FoodCategory.id == FoodLog.category_id)
                .where(
                    FoodLog.user_id == user.id,
                    FoodCategory.is_junk.is_(True),
                    _local_day(user) >= window_start,
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

    # A day with no logs at all counts as junk free, which is what "days without
    # a junk flagged log" literally means. The walk stops at the first day the
    # user ever logged, not at the window edge: days before the account had any
    # history are not clean days someone earned, and counting them would hand a
    # user who logged one salad this morning a streak of a full year.
    earliest = max(first_logged_day, window_start)

    current_streak = 0
    cursor = today
    while cursor >= earliest and cursor not in junk_days:
        current_streak += 1
        cursor -= dt.timedelta(days=1)

    longest_streak = 0
    run = 0
    day = earliest
    while day <= today:
        if day in junk_days:
            run = 0
        else:
            run += 1
            longest_streak = max(longest_streak, run)
        day += dt.timedelta(days=1)

    return StreaksOut(
        current_streak=current_streak,
        longest_streak=longest_streak,
        last_junk_date=max(junk_days) if junk_days else None,
        message=_streak_message(current_streak, has_any_logs=True),
    )
