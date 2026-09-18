"""Seed demo content: a demo user, restaurants and a believable log history.

    python -m app.seed.run            # reseed demo data
    python -m app.seed.run --reset    # remove demo data, then stop

Cuisines and food categories are NOT created here: they are reference data and
live in migration 0002. This script only creates the things a real user would
have created, so wiping it never leaves the app unusable.

Deterministic by design. The generator is seeded with a fixed value, so the same
history comes out on every run and screenshots and tests stay stable. Only the anchor date moves, because the logs are positioned relative to
today so the dashboard never looks abandoned.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import random
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionLocal
from app.models import Cuisine, FoodCategory, FoodLog, Restaurant, User
from app.models.enums import FriendScale, Goal, ServingSize
from app.seed.data import DISH_NAMES, RESTAURANTS
from app.services.ai.fake import DeterministicAIService
from app.services.ai.schemas import CalorieAdjustRequest
from app.services.calories import finalise_estimate
from app.services.insights import KCAL_PER_MINUTE
from app.services.security import hash_password

DEMO_EMAIL = "demo@forkast.app"
DEMO_PASSWORD = "demo1234"
DAYS_OF_HISTORY = 90
TARGET_LOGS = 120
RANDOM_SEED = 20260916


async def _clear_demo_data(session: AsyncSession) -> None:
    """Remove the demo user and the seeded restaurants.

    Deleting the user cascades to their logs and plans. Restaurants are removed
    separately because they are shared rather than owned, and food_logs points
    at them with ON DELETE SET NULL.
    """
    user = await session.scalar(select(User).where(func.lower(User.email) == DEMO_EMAIL))
    if user is not None:
        await session.delete(user)
        await session.flush()

    await session.execute(
        delete(Restaurant).where(Restaurant.name.in_([r.name for r in RESTAURANTS]))
    )


async def _ensure_restaurants(session: AsyncSession, created_by) -> list[Restaurant]:
    restaurants: list[Restaurant] = []
    for seed in RESTAURANTS:
        existing = await session.scalar(
            select(Restaurant).where(
                func.lower(Restaurant.name) == seed.name.lower(),
                func.coalesce(func.lower(Restaurant.area), "") == seed.area.lower(),
            )
        )
        if existing is None:
            existing = Restaurant(
                name=seed.name,
                area=seed.area,
                latitude=seed.latitude,
                longitude=seed.longitude,
                created_by=created_by,
            )
            session.add(existing)
            await session.flush()
        restaurants.append(existing)
    return restaurants


async def _generate_logs(
    session: AsyncSession,
    user: User,
    categories: list[FoodCategory],
    restaurants: list[Restaurant],
) -> list[FoodLog]:
    rng = random.Random(RANDOM_SEED)
    ai = DeterministicAIService()
    tz = ZoneInfo(user.timezone)
    now = dt.datetime.now(tz)

    loggable = [c for c in categories if DISH_NAMES.get(c.slug)]

    # Weight the non junk categories a little higher so the seeded history reads
    # like a normal person's diary rather than a fast food binge.
    weights = [1.0 if cat.is_junk else 1.8 for cat in loggable]

    meal_slots = [(8, 30), (13, 15), (16, 0), (20, 30)]
    logs: list[FoodLog] = []

    for _ in range(TARGET_LOGS):
        days_ago = rng.randint(0, DAYS_OF_HISTORY - 1)
        hour, minute = rng.choice(meal_slots)
        # Jitter is applied as an offset, not by rewriting the minute field,
        # which would go negative for an on-the-hour slot.
        created_at = (now - dt.timedelta(days=days_ago)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        ) + dt.timedelta(minutes=rng.randint(-20, 20))
        if created_at > now:
            created_at = now - dt.timedelta(hours=rng.randint(1, 6))

        category = rng.choices(loggable, weights=weights, k=1)[0]
        dish_name = rng.choice(DISH_NAMES[category.slug])
        serving_size = rng.choices(
            [ServingSize.small, ServingSize.medium, ServingSize.large], weights=[2, 6, 2], k=1
        )[0]

        adjustment = await ai.adjust_calories(
            CalorieAdjustRequest(
                dish_name=dish_name,
                category_name=category.name,
                base_calorie_min=category.base_calorie_min,
                base_calorie_max=category.base_calorie_max,
                serving_size=serving_size,
            )
        )
        estimated = finalise_estimate(
            adjustment.calories,
            category.base_calorie_min,
            category.base_calorie_max,
            serving_size,
        )

        # Roughly a third of meals are eaten at home, with no restaurant.
        restaurant = rng.choice(restaurants) if rng.random() > 0.33 else None

        log = FoodLog(
            user_id=user.id,
            dish_name=dish_name,
            category_id=category.id,
            restaurant_id=restaurant.id if restaurant else None,
            area=restaurant.area if restaurant else None,
            rating=rng.choices([3, 4, 5], weights=[2, 5, 3], k=1)[0],
            fun_scale=rng.choice([None, 3, 4, 4, 5, 5]),
            friend_scale=rng.choice(
                [None, FriendScale.solo, FriendScale.small_group, FriendScale.squad]
            ),
            serving_size=serving_size,
            estimated_calories=estimated,
            created_at=created_at,
        )
        session.add(log)
        logs.append(log)

    await session.flush()
    return logs


def _summarise(user: User, logs: list[FoodLog], categories: list[FoodCategory]) -> dict:
    """Summarise what was just seeded, for the console output only.

    The endpoints compute their own figures in SQL now. This exists so the seed
    prints something meaningful about the history it created, and it doubles as
    an independent second implementation: if the printed streak disagrees with
    what /streaks returns, one of the two is wrong.
    """
    tz = ZoneInfo(user.timezone)
    cat_by_id = {c.id: c for c in categories}

    total_calories = sum(log.estimated_calories for log in logs)
    junk_count = sum(1 for log in logs if cat_by_id[log.category_id].is_junk)
    junk_ratio = round(junk_count / len(logs), 4) if logs else 0.0

    # Bucket into calendar days in the user's own timezone, not UTC. In Karachi
    # a UTC day rolls over at 5am local, so a late dinner would land on the
    # wrong day and the streak would look wrong.
    by_day: dict[dt.date, int] = defaultdict(int)
    junk_days: set[dt.date] = set()
    for log in logs:
        local_day = log.created_at.astimezone(tz).date()
        by_day[local_day] += log.estimated_calories
        if cat_by_id[log.category_id].is_junk:
            junk_days.add(local_day)

    today = dt.datetime.now(tz).date()
    calories_by_day = [
        {
            "day": today - dt.timedelta(days=offset),
            "calories": by_day.get(today - dt.timedelta(days=offset), 0),
        }
        for offset in range(13, -1, -1)
    ]

    # Streak: consecutive days with no junk flagged log, counting back from
    # today. A day with no logs at all counts as junk free.
    current_streak = 0
    cursor = today
    while cursor not in junk_days and current_streak < DAYS_OF_HISTORY:
        current_streak += 1
        cursor -= dt.timedelta(days=1)

    longest_streak = 0
    run = 0
    earliest = min(by_day) if by_day else today
    day = earliest
    while day <= today:
        if day in junk_days:
            run = 0
        else:
            run += 1
            longest_streak = max(longest_streak, run)
        day += dt.timedelta(days=1)

    last_junk_date = max(junk_days) if junk_days else None

    category_counts = Counter(log.category_id for log in logs)
    top_category = None
    if category_counts:
        top_id, top_count = category_counts.most_common(1)[0]
        top_category = {
            "category_id": top_id,
            "name": cat_by_id[top_id].name,
            "count": top_count,
        }

    restaurant_counts = Counter(log.restaurant_id for log in logs if log.restaurant_id)
    top_restaurant = None
    if restaurant_counts:
        top_rid, top_rcount = restaurant_counts.most_common(1)[0]
        name = next(
            (
                log.restaurant.name
                for log in logs
                if log.restaurant_id == top_rid and log.restaurant
            ),
            "Unknown",
        )
        top_restaurant = {"restaurant_id": top_rid, "name": name, "count": top_rcount}

    best_fun_meals = [
        {
            "dish_name": log.dish_name,
            "fun_scale": log.fun_scale,
            "restaurant_name": log.restaurant.name if log.restaurant else None,
        }
        for log in sorted(
            (log for log in logs if log.fun_scale is not None),
            key=lambda log: (log.fun_scale, log.created_at),
            reverse=True,
        )[:5]
    ]

    # Burn equivalents are for an average day rather than the whole 90 days,
    # which would be a meaningless number of hours.
    avg_day_calories = total_calories / max(len(by_day), 1)
    burn = {
        f"{activity}_minutes": round(avg_day_calories / rate)
        for activity, rate in KCAL_PER_MINUTE.items()
    }

    if current_streak == 0:
        message = "Streak reset today. No drama, the next log starts a new one."
    elif current_streak < 3:
        message = f"{current_streak} clean day so far. Worth protecting."
    else:
        message = f"{current_streak} days without a junk log. Quietly impressive."

    return {
        "dashboard": {
            "junk_ratio": junk_ratio,
            "total_calories": total_calories,
            "logs_count": len(logs),
            "calories_by_day": calories_by_day,
            "top_category": top_category,
            "top_restaurant": top_restaurant,
            "best_fun_meals": best_fun_meals,
            "burn_equivalents": burn,
        },
        "streaks": {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_junk_date": last_junk_date,
            "message": message,
        },
    }


async def seed(reset_only: bool = False) -> None:
    settings = get_settings()

    async with SessionLocal() as session:
        await _clear_demo_data(session)

        if reset_only:
            await session.commit()
            print("Demo data removed.")
            return

        categories = list(await session.scalars(select(FoodCategory)))
        if not categories:
            raise SystemExit("No food categories found. Run `alembic upgrade head` before seeding.")

        user = User(
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            timezone=settings.default_timezone,
            goal=Goal.maintain,
        )
        session.add(user)
        await session.flush()

        restaurants = await _ensure_restaurants(session, created_by=user.id)
        logs = await _generate_logs(session, user, categories, restaurants)

        summary = _summarise(user, logs, categories)

        await session.commit()

        cuisine_count = await session.scalar(select(func.count()).select_from(Cuisine))
        print(f"Seeded demo user   {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print(f"        cuisines   {cuisine_count}")
        print(f"      categories   {len(categories)}")
        print(f"     restaurants   {len(restaurants)}")
        print(f"       food logs   {len(logs)} across {DAYS_OF_HISTORY} days")
        print(
            f"          streak   current {summary['streaks']['current_streak']}, "
            f"longest {summary['streaks']['longest_streak']}"
        )
        print(f"       junk ratio   {summary['dashboard']['junk_ratio']:.0%}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Forkast demo data.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Remove the demo user and the seeded restaurants, then stop.",
    )
    args = parser.parse_args()
    asyncio.run(seed(reset_only=args.reset))


if __name__ == "__main__":
    main()
