"""Give the demo account a small, curated, recent diary with real photos.

    python -m scripts.seed_recent_demo_meals
    DATABASE_URL=<neon url> python -m scripts.seed_recent_demo_meals

The bulk historical seed (app/seed/run.py) exists to give the dashboard and
streaks real depth over 90 days, and only photographs ~45% of what it
creates on purpose -- that is the right mix for testing history.tsx's photo
card layout against a photoless one, but it is not what belongs on screen in
front of someone who has never seen the app before. This script does two
things, against whatever DATABASE_URL points at:

1. Deletes every one of the demo account's existing food logs that has no
   photo (the bulk seed's photoless ~55%, and anything else photoless that
   accumulated). Logs that already have a photo -- including the bulk
   seed's own synthetic ones -- are left alone.
2. Adds CURATED_MEALS below: a dozen real, recognisable dishes spread over
   the last ten days, mixing junk and clean, most carrying a real photo
   (read from PHOTO_DIR, matched by filename below) and a few left
   deliberately photoless where no picture was provided.

Idempotent: re-running it first removes anything a previous run of this
exact script added (identified by dish name, matched against this file's own
CURATED_MEALS list) before inserting fresh rows, so adjusting a date or
swapping a photo and running it again never piles up duplicates. Requires
the demo account to already exist -- this does not create one, and does not
touch app/seed/run.py's own production guard, since it is not minting a new
publicly-known credential, only editing an existing account's history.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import FoodCategory, FoodLog, FoodLogPhoto, User
from app.models.enums import FriendScale, ServingSize
from app.seed.run import DEMO_EMAIL
from app.services.ai.fake import DeterministicAIService
from app.services.ai.schemas import CalorieAdjustRequest
from app.services.calories import finalise_estimate
from app.services.images import sniff

# Where the real photos live. Not checked into git -- see this folder's own
# README, same convention scripts/fixtures already uses for live_ai_check.py.
PHOTO_DIR = Path(r"C:\Users\noorr\Downloads\sample food")


class CuratedMeal:
    def __init__(
        self,
        dish_name: str,
        category_slug: str,
        days_ago: int,
        hour: int,
        minute: int,
        rating: int,
        fun_scale: int | None,
        friend_scale: FriendScale | None,
        serving_size: ServingSize,
        photo_filename: str | None,
    ) -> None:
        self.dish_name = dish_name
        self.category_slug = category_slug
        self.days_ago = days_ago
        self.hour = hour
        self.minute = minute
        self.rating = rating
        self.fun_scale = fun_scale
        self.friend_scale = friend_scale
        self.serving_size = serving_size
        self.photo_filename = photo_filename


# Spread over the last ten days (today included), at the kind of hour each
# meal actually happens at, so the diary reads as a real week instead of a
# dozen entries dropped on top of each other. Seven clean-ish, five junk --
# roughly the same "mostly fine, not a saint" balance app/seed/data.py's own
# category weighting goes for.
CURATED_MEALS = [
    CuratedMeal(
        "chicken tikka boti",
        "bbq_tikka",
        days_ago=1,
        hour=20,
        minute=15,
        rating=5,
        fun_scale=4,
        friend_scale=FriendScale.small_group,
        serving_size=ServingSize.medium,
        photo_filename="Chicken Tikka.jpg",
    ),
    CuratedMeal(
        "chicken biryani",
        "biryani",
        days_ago=3,
        hour=13,
        minute=30,
        rating=5,
        fun_scale=4,
        friend_scale=FriendScale.squad,
        serving_size=ServingSize.large,
        photo_filename=None,
    ),
    CuratedMeal(
        "greek salad",
        "salad",
        days_ago=0,
        hour=12,
        minute=45,
        rating=4,
        fun_scale=3,
        friend_scale=FriendScale.solo,
        serving_size=ServingSize.medium,
        photo_filename="salad.jpg",
    ),
    CuratedMeal(
        "beef burger",
        "burger",
        days_ago=6,
        hour=19,
        minute=50,
        rating=4,
        fun_scale=4,
        friend_scale=FriendScale.small_group,
        serving_size=ServingSize.medium,
        photo_filename=None,
    ),
    CuratedMeal(
        "margherita pizza",
        "pizza",
        days_ago=8,
        hour=20,
        minute=30,
        rating=5,
        fun_scale=5,
        friend_scale=FriendScale.squad,
        serving_size=ServingSize.large,
        photo_filename=None,
    ),
    CuratedMeal(
        "salmon sushi platter",
        "sushi",
        days_ago=2,
        hour=19,
        minute=10,
        rating=5,
        fun_scale=4,
        friend_scale=FriendScale.solo,
        serving_size=ServingSize.medium,
        photo_filename="salmon sushi.jpg",
    ),
    CuratedMeal(
        "halwa puri",
        "halwa_puri",
        days_ago=4,
        hour=9,
        minute=0,
        rating=4,
        fun_scale=3,
        friend_scale=FriendScale.small_group,
        serving_size=ServingSize.medium,
        photo_filename="Brkfst (halwa puri).jpg",
    ),
    CuratedMeal(
        "grilled salmon",
        "grilled_seafood",
        days_ago=5,
        hour=20,
        minute=0,
        rating=5,
        fun_scale=None,
        friend_scale=FriendScale.solo,
        serving_size=ServingSize.medium,
        photo_filename="grilled salmon.jpg",
    ),
    CuratedMeal(
        "chocolate brownie",
        "dessert",
        days_ago=0,
        hour=17,
        minute=30,
        rating=5,
        fun_scale=5,
        friend_scale=FriendScale.small_group,
        serving_size=ServingSize.small,
        photo_filename="brownie.jpg",
    ),
    CuratedMeal(
        "chicken shawarma",
        "shawarma",
        days_ago=7,
        hour=13,
        minute=45,
        rating=4,
        fun_scale=3,
        friend_scale=FriendScale.solo,
        serving_size=ServingSize.medium,
        photo_filename="chicken shawarma.jpg",
    ),
    CuratedMeal(
        "fruit bowl",
        "fruit",
        days_ago=1,
        hour=8,
        minute=15,
        rating=4,
        fun_scale=None,
        friend_scale=FriendScale.solo,
        serving_size=ServingSize.medium,
        photo_filename="fruits.jpg",
    ),
    CuratedMeal(
        "pad thai",
        "pad_thai",
        days_ago=9,
        hour=20,
        minute=10,
        rating=4,
        fun_scale=4,
        friend_scale=FriendScale.small_group,
        serving_size=ServingSize.medium,
        photo_filename="Pad Thai.jpg",
    ),
]


async def _remove_photoless_logs(session: AsyncSession, user: User) -> int:
    photoless_ids = (
        await session.scalars(
            select(FoodLog.id)
            .outerjoin(FoodLogPhoto, FoodLogPhoto.food_log_id == FoodLog.id)
            .where(FoodLog.user_id == user.id, FoodLogPhoto.food_log_id.is_(None))
        )
    ).all()
    if not photoless_ids:
        return 0
    await session.execute(delete(FoodLog).where(FoodLog.id.in_(photoless_ids)))
    return len(photoless_ids)


async def _remove_previous_curated_meals(session: AsyncSession, user: User) -> None:
    dish_names = [meal.dish_name for meal in CURATED_MEALS]
    await session.execute(
        delete(FoodLog).where(FoodLog.user_id == user.id, FoodLog.dish_name.in_(dish_names))
    )


async def _add_curated_meals(
    session: AsyncSession, user: User, categories: dict[str, FoodCategory]
) -> tuple[int, int, list[str]]:
    ai = DeterministicAIService()
    tz = ZoneInfo(user.timezone)
    now = dt.datetime.now(tz)

    added = 0
    photographed = 0
    missing_photos: list[str] = []

    for meal in CURATED_MEALS:
        category = categories.get(meal.category_slug)
        if category is None:
            raise SystemExit(f"No category with slug {meal.category_slug!r} -- check the catalog.")

        created_at = (now - dt.timedelta(days=meal.days_ago)).replace(
            hour=meal.hour, minute=meal.minute, second=0, microsecond=0
        )
        if created_at > now:
            created_at = now

        adjustment = await ai.adjust_calories(
            CalorieAdjustRequest(
                dish_name=meal.dish_name,
                category_name=category.name,
                base_calorie_min=category.base_calorie_min,
                base_calorie_max=category.base_calorie_max,
                serving_size=meal.serving_size,
            )
        )
        estimated = finalise_estimate(
            adjustment.calories,
            category.base_calorie_min,
            category.base_calorie_max,
            meal.serving_size,
        )

        log = FoodLog(
            user_id=user.id,
            dish_name=meal.dish_name,
            category_id=category.id,
            rating=meal.rating,
            fun_scale=meal.fun_scale,
            friend_scale=meal.friend_scale,
            serving_size=meal.serving_size,
            estimated_calories=estimated,
            created_at=created_at,
        )
        session.add(log)
        added += 1

        if meal.photo_filename is None:
            continue

        photo_path = PHOTO_DIR / meal.photo_filename
        if not photo_path.exists():
            missing_photos.append(meal.photo_filename)
            continue

        data = photo_path.read_bytes()
        content_type = sniff(data)
        if content_type is None:
            missing_photos.append(f"{meal.photo_filename} (not a recognised image)")
            continue

        await session.flush()  # log.id is a Python-side default, resolved at flush.
        session.add(
            FoodLogPhoto(
                food_log_id=log.id,
                content_type=content_type,
                byte_size=len(data),
                data=data,
            )
        )
        photographed += 1

    return added, photographed, missing_photos


async def main() -> None:
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(func.lower(User.email) == DEMO_EMAIL))
        if user is None:
            raise SystemExit(
                f"No demo account found at {DEMO_EMAIL!r}. Run `python -m app.seed.run` "
                "(against a non-production database) to create one first."
            )

        removed = await _remove_photoless_logs(session, user)
        await _remove_previous_curated_meals(session, user)

        categories = {c.slug: c for c in await session.scalars(select(FoodCategory))}
        added, photographed, missing_photos = await _add_curated_meals(session, user, categories)

        await session.commit()

        print(f"Removed {removed} existing photoless log(s).")
        print(f"Added {added} curated meal(s), {photographed} with a real photo.")
        if missing_photos:
            print("No photo found for (added without one):")
            for name in missing_photos:
                print(f"  - {name}")


if __name__ == "__main__":
    asyncio.run(main())
