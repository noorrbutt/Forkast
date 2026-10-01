"""Saving, editing and repeating meals, and pricing them.

The log routes hand everything past parsing to the functions here. A meal is
saved with a provisional figure straight away and refined by the model behind
the response; see provisional_estimate for why it is done in that order.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.api.v1.catalog import upsert_restaurant
from app.config import get_settings
from app.models import FoodCategory, FoodLog, FoodLogPhoto, Restaurant, User
from app.models.enums import ServingSize
from app.schemas.logs import FoodLogCreate, FoodLogUpdate
from app.services.ai.base import AIService
from app.services.ai.groq_service import GroqResponseError
from app.services.ai.schemas import CalorieAdjustRequest, PhotoCalorieEstimate
from app.services.calories import clamp_photo_estimate, finalise_estimate
from app.services.images import compress_for_estimation
from app.services.rate_limit import RateLimiter, account_identity

logger = logging.getLogger(__name__)

# Fields that feed the estimate. Editing any of them means the stored figure
# has to be redone, otherwise the calories quietly stop matching the log.
_ESTIMATE_INPUTS = frozenset({"dish_name", "category_id", "serving_size"})


def provisional_estimate(category: FoodCategory, serving_size: ServingSize) -> int:
    """The figure to store right now, with no model in the way.

    The midpoint of the category's own range, clamped and scaled exactly as the
    model's answer would be. It is the same arithmetic on a different input, so
    a provisional figure and a refined one are never different kinds of number.

    This exists because asking the model first made saving a meal take a median
    of two seconds against thirty milliseconds for everything else the app does,
    on the one action the whole product is for. It also made the estimator a
    hard dependency of logging: a rate limit or an outage turned a save into a
    502 and the meal was simply lost.

    What the model adds is placement inside a range that is already known, so
    the honest description of this number is "right kind of figure, not yet
    refined", and the refinement lands a moment later without anyone waiting on
    it.
    """
    midpoint = (category.base_calorie_min + category.base_calorie_max) / 2
    return finalise_estimate(
        midpoint, category.base_calorie_min, category.base_calorie_max, serving_size
    )


async def estimate_calories(
    ai: AIService,
    *,
    dish_name: str,
    category_name: str,
    base_calorie_min: int,
    base_calorie_max: int,
    serving_size: ServingSize,
) -> int:
    """Ask the AI for an in-range figure, then clamp and scale it.

    The clamp happens before the serving multiplier on purpose: the model's job
    is only ever to place the dish inside the category range, while a large
    portion is still allowed to exceed that range once scaled.
    """
    try:
        adjustment = await ai.adjust_calories(
            CalorieAdjustRequest(
                dish_name=dish_name,
                category_name=category_name,
                base_calorie_min=base_calorie_min,
                base_calorie_max=base_calorie_max,
                serving_size=serving_size,
            )
        )
    except GroqResponseError as exc:
        # The AI provider is upstream of us, so its failure is a 502 rather than
        # a 500. The log still gets written by the caller's retry; nothing here
        # has been persisted yet.
        logger.warning("Calorie estimation failed", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The calorie estimator is unavailable.",
        ) from exc
    return finalise_estimate(
        adjustment.calories,
        base_calorie_min,
        base_calorie_max,
        serving_size,
    )


async def refine_estimate(
    log_id: uuid.UUID,
    category_id: int,
    ai: AIService,
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """Replace a provisional figure with the model's, after the response is out.

    The first session only reads the values needed for the model, then closes
    before the Groq call so the DB pool is free for other requests. The second
    session updates the row only after the estimate is ready.
    """
    try:
        async with factory() as session:
            log = await session.get(FoodLog, log_id)
            # Edited or deleted while the model was thinking, which is a race
            # this has to lose rather than overwrite.
            if log is None or log.category_id != category_id:
                return

            category = await session.get(FoodCategory, category_id)
            if category is None:
                return

            dish_name = log.dish_name
            serving_size = log.serving_size
            category_name = category.name
            base_calorie_min = category.base_calorie_min
            base_calorie_max = category.base_calorie_max

        refined = await estimate_calories(
            ai,
            dish_name=dish_name,
            category_name=category_name,
            base_calorie_min=base_calorie_min,
            base_calorie_max=base_calorie_max,
            serving_size=serving_size,
        )

        async with factory() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE food_logs
                    SET estimated_calories = :value,
                        estimate_refined_at = NOW()
                    WHERE id = :id
                      AND category_id = :category_id
                      AND dish_name = :dish_name
                      AND serving_size = :serving_size
                    """
                ),
                {
                    "value": refined,
                    "id": log_id,
                    "category_id": category_id,
                    "dish_name": dish_name,
                    "serving_size": serving_size,
                },
            )
            if result.rowcount == 0:
                return
            await session.commit()
    except Exception:
        logger.error("refine_failed log_id=%s", log_id, exc_info=True)


async def get_category(session: AsyncSession, category_id: int) -> FoodCategory:
    category = await session.get(FoodCategory, category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown category_id {category_id}",
        )
    return category


async def require_restaurant(session: AsyncSession, restaurant_id: uuid.UUID | None) -> None:
    """A restaurant id that does not exist is a client error, not a server one.

    Without this the value reaches the foreign key and the integrity error
    surfaces as a 500.
    """
    if restaurant_id is None:
        return
    if await session.get(Restaurant, restaurant_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown restaurant_id {restaurant_id}",
        )


async def load_log(session: AsyncSession, user_id: uuid.UUID, log_id: uuid.UUID) -> FoodLog:
    log = await session.scalar(
        select(FoodLog)
        .where(FoodLog.id == log_id, FoodLog.user_id == user_id)
        .options(selectinload(FoodLog.category), selectinload(FoodLog.restaurant))
        # populate_existing because assigning a raw foreign key column does not
        # refresh the relationship that was already loaded beside it, and a
        # plain reload resolves to the same identity-mapped object without
        # overwriting it. Without this, PATCHing category_id returns the new id
        # next to the old nested category, and a client rendering from the
        # nested object shows the wrong thing. Safe at every call site: the two
        # with pending changes flush first.
        .execution_options(populate_existing=True)
    )
    if log is None:
        # 404 rather than 403 for a log belonging to someone else: no reason to
        # confirm that an id exists.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food log not found")
    return log


async def _already_saved(
    session: AsyncSession, user: User, client_id: uuid.UUID | None
) -> FoodLog | None:
    """The row an earlier attempt at this same save already made, if any."""
    if client_id is None:
        return None
    existing = await session.scalar(
        select(FoodLog).where(FoodLog.user_id == user.id, FoodLog.client_id == client_id)
    )
    return await load_log(session, user.id, existing.id) if existing is not None else None


async def _spend_daily(limiter: RateLimiter, bucket: str, user: User, limit: int) -> None:
    await limiter.hit(bucket, account_identity(user.id), limit=limit, window_seconds=86400)


async def _restaurant_for(
    session: AsyncSession, limiter: RateLimiter, user: User, payload: FoodLogCreate
) -> uuid.UUID | None:
    """The restaurant this meal is against: an existing id, or a name that is
    found or added to the shared registry, which is what the daily cap is on."""
    await require_restaurant(session, payload.restaurant_id)
    if not payload.restaurant_name:
        return payload.restaurant_id
    await _spend_daily(limiter, "restaurant-day", user, get_settings().restaurant_daily_limit)
    restaurant, _ = await upsert_restaurant(
        session,
        name=payload.restaurant_name,
        area=payload.area,
        created_by=user.id,
    )
    return restaurant.id


def _initial_estimate(
    payload: FoodLogCreate, category: FoodCategory
) -> tuple[int, str, dt.datetime | None]:
    """The figure a new log is saved with, where it came from, and whether it
    is already final.

    A photo estimate carries its own number, already answered for the real
    plate in the photo rather than for a category's nominal range. Using it is
    what makes the figure someone confirmed on the estimate screen the same
    figure that lands on the diary entry -- see clamp_photo_estimate's own note
    on why that clamp is not finalise_estimate's clamp. It is marked refined
    straight away: scheduling refine_estimate would risk replacing a real
    vision-model figure with a worse, text-only guess, and a refined stamp is
    what keeps refine-backfill (app/maintenance.py) from ever picking the row
    up either.

    Absent, the log is saved with a figure that needs nobody's permission and
    refined behind the response. See provisional_estimate.
    """
    if payload.estimated_calories is not None:
        estimated = clamp_photo_estimate(
            payload.estimated_calories, category.base_calorie_min, category.base_calorie_max
        )
        return estimated, "photo", dt.datetime.now(dt.UTC)
    return provisional_estimate(category, payload.serving_size), "category", None


async def create_log(
    session: AsyncSession, limiter: RateLimiter, user: User, payload: FoodLogCreate
) -> tuple[FoodLog, bool]:
    """Save a meal, and say whether this call created it.

    False means a row with the same client_id was already there and is what
    comes back. That is checked before either quota is touched: an offline
    client retries the same client_id until it sees a 2xx, and without this an
    ordinary spotty connection burned one real log_daily_limit slot per retry
    rather than the one meal it actually represents.
    """
    existing = await _already_saved(session, user, payload.client_id)
    if existing is not None:
        return existing, False

    await _spend_daily(limiter, "log-day", user, get_settings().log_daily_limit)
    category = await get_category(session, payload.category_id)
    restaurant_id = await _restaurant_for(session, limiter, user, payload)
    estimated, calorie_source, estimate_refined_at = _initial_estimate(payload, category)

    log = FoodLog(
        user_id=user.id,
        dish_name=payload.dish_name,
        category_id=category.id,
        restaurant_id=restaurant_id,
        area=payload.area,
        rating=payload.rating,
        fun_scale=payload.fun_scale,
        friend_scale=payload.friend_scale,
        serving_size=payload.serving_size,
        estimated_calories=estimated,
        calorie_source=calorie_source,
        protein_g=payload.protein_g,
        carbs_g=payload.carbs_g,
        fat_g=payload.fat_g,
        estimate_refined_at=estimate_refined_at,
        client_id=payload.client_id,
    )
    if payload.created_at is not None:
        log.created_at = payload.created_at

    session.add(log)
    try:
        await session.flush()
    except IntegrityError:
        # Two copies of the same save racing each other: the loser answers
        # from the winner's row, same as a retry that arrived later would.
        await session.rollback()
        existing = await _already_saved(session, user, payload.client_id)
        if existing is not None:
            return existing, False
        raise
    created = await load_log(session, user.id, log.id)
    await session.commit()
    return created, True


async def list_logs(
    session: AsyncSession, user: User, *, limit: int, offset: int
) -> tuple[list[FoodLog], int]:
    total = await session.scalar(
        select(func.count()).select_from(FoodLog).where(FoodLog.user_id == user.id)
    )
    rows = await session.scalars(
        select(FoodLog)
        .where(FoodLog.user_id == user.id)
        .order_by(FoodLog.created_at.desc())
        .limit(limit)
        .offset(offset)
        .options(selectinload(FoodLog.category), selectinload(FoodLog.restaurant))
    )
    return list(rows), total or 0


async def update_log(
    session: AsyncSession, user: User, log_id: uuid.UUID, payload: FoodLogUpdate
) -> tuple[FoodLog, bool]:
    """Apply the sent fields, and say whether the estimate now needs refining."""
    log = await load_log(session, user.id, log_id)
    changes = payload.model_dump(exclude_unset=True)

    if "category_id" in changes:
        await get_category(session, changes["category_id"])
    if "restaurant_id" in changes:
        await require_restaurant(session, changes["restaurant_id"])

    for field, value in changes.items():
        setattr(log, field, value)

    refine = bool(_ESTIMATE_INPUTS & changes.keys())
    if refine:
        category = await get_category(session, log.category_id)
        log.estimated_calories = provisional_estimate(category, log.serving_size)
        log.estimate_refined_at = None
        # The dish name, category or serving size just changed, so a photo
        # estimate from a previous save no longer describes this row -- the
        # figure is a fresh category-derived guess now, not the number a
        # photo confirmed, and the macros were for the old dish/serving.
        log.calorie_source = "category"
        log.protein_g = None
        log.carbs_g = None
        log.fat_g = None

    await session.flush()
    updated = await load_log(session, user.id, log.id)
    await session.commit()
    return updated, refine


async def may_refine(limiter: RateLimiter, user: User) -> bool:
    """Whether an edit's refinement fits in the hourly cap.

    Over the cap the edit has still been saved, with its provisional figure;
    only the model call is skipped, so the limit never costs anyone a meal.
    """
    try:
        await limiter.hit(
            "refine",
            account_identity(user.id),
            limit=get_settings().refine_rate_limit,
            window_seconds=3600,
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
            raise
        return False
    return True


async def delete_log(session: AsyncSession, user: User, log_id: uuid.UUID) -> None:
    log = await load_log(session, user.id, log_id)
    await session.delete(log)
    await session.commit()


async def _copy_photo(session: AsyncSession, original: FoodLog, repeated: FoodLog) -> None:
    """Carry the picture over too.

    A repeat that loses the photo is a repeat of the text only, and the diary
    then shows yesterday's biryani with a picture and today's identical one
    without, which reads as the photo having failed to upload.

    Copied rather than shared, and the schema leaves no choice: food_log_photos
    has a unique index on food_log_id, so a row belongs to exactly one meal.
    Sharing would mean inverting the ownership and then deciding what happens
    when one of the two meals is deleted, which is a lot of machinery to avoid
    duplicating a file the server already caps at 1000 KB.

    Selected explicitly rather than through original.photo, because that
    relationship is lazy="raise_on_sql" and load_log does not eager load it, so
    touching the attribute raises instead of quietly issuing a query.
    """
    photo = await session.scalar(
        select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == original.id)
    )
    if photo is None:
        return
    session.add(
        FoodLogPhoto(
            food_log_id=repeated.id,
            content_type=photo.content_type,
            byte_size=photo.byte_size,
            data=photo.data,
        )
    )
    await session.flush()


async def repeat_log(
    session: AsyncSession, limiter: RateLimiter, user: User, log_id: uuid.UUID
) -> FoodLog:
    """Log the same thing again, now, without retyping any of it.

    A new row rather than a counter on the old one: two chai at nine and at four
    are two meals on two parts of the day, and collapsing them would flatten the
    calorie chart and the streak alike.
    """
    await _spend_daily(limiter, "log-day", user, get_settings().log_daily_limit)
    original = await load_log(session, user.id, log_id)

    repeated = FoodLog(
        user_id=user.id,
        dish_name=original.dish_name,
        category_id=original.category_id,
        restaurant_id=original.restaurant_id,
        area=original.area,
        rating=original.rating,
        fun_scale=original.fun_scale,
        friend_scale=original.friend_scale,
        serving_size=original.serving_size,
        # Copied, not re-estimated. The estimate is a function of dish name,
        # category range and serving size, and all three are carried over
        # unchanged, so asking again can only return the same number or, once a
        # real model is behind the seam, a different one for an identical meal;
        # the user would see the same dish costing two different amounts. It
        # also keeps this route a pure database copy, so a one tap repeat cannot
        # fail with a 502 or wait on an upstream call.
        estimated_calories=original.estimated_calories,
        estimate_refined_at=original.estimate_refined_at,
        # Same reasoning as the calorie figure above: a repeat of a
        # photo-priced meal is still describing that same photographed
        # plate, not a fresh guess, so its provenance and macros travel with
        # it rather than reading as an unexplained category-priced log.
        calorie_source=original.calorie_source,
        protein_g=original.protein_g,
        carbs_g=original.carbs_g,
        fat_g=original.fat_g,
    )
    # created_at is deliberately left to the column default. That is the whole
    # point of a repeat: same meal, this moment.
    session.add(repeated)
    await session.flush()
    await _copy_photo(session, original, repeated)

    created = await load_log(session, user.id, repeated.id)
    await session.commit()
    return created


async def guard_photo_estimate(limiter: RateLimiter, user: User, *, live: bool) -> None:
    """The kill switch and the two rate limits in front of a vision call.

    All skipped when the estimator is not live: the fake one never looks at the
    bytes, so none of them would be protecting a real cost.
    """
    if not live:
        return
    settings = get_settings()
    if not settings.photo_estimate_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Photo scanning is temporarily unavailable. Try typing this one in.",
        )
    # Short window first: it is the one that actually stops a burst, and
    # failing fast on it means a caller who is about to be blocked by the
    # daily cap anyway does not also pay for a second counter increment.
    await limiter.hit(
        "photo-estimate",
        account_identity(user.id),
        limit=settings.photo_estimate_rate_limit,
        window_seconds=settings.photo_estimate_rate_window_seconds,
    )
    await _spend_daily(limiter, "photo-estimate-day", user, settings.photo_estimate_daily_limit)


async def estimate_photo(
    ai: AIService, data: bytes, content_type: str, *, live: bool
) -> PhotoCalorieEstimate:
    """Ask the model what is on a photo that has already passed check_upload.

    Downscaled first when the estimator is live, since a vision request bills
    for the whole image.
    """
    if live:
        try:
            data = compress_for_estimation(data)
            content_type = "image/jpeg"
        except Exception as exc:
            # sniff already confirmed a real signature, so a decode failure
            # here means the file is truncated or otherwise corrupt past its
            # header rather than genuinely not an image.
            logger.warning("Could not downscale an uploaded photo", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="That photo could not be read. Try another one.",
            ) from exc

    try:
        return await ai.estimate_from_photo(data, content_type)
    except GroqResponseError as exc:
        # Same reasoning as estimate_calories: the provider is upstream of us,
        # so its failure is a 502. Nothing has been persisted, so there is
        # nothing to roll back and no meal at risk of being lost, unlike a
        # provider outage during a text log.
        logger.warning("Photo calorie estimation failed", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The photo estimator is unavailable.",
        ) from exc


async def set_photo(session: AsyncSession, log: FoodLog, data: bytes, content_type: str) -> None:
    """One photo per meal: a second upload replaces the first in place."""
    existing = await session.scalar(select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == log.id))
    if existing is None:
        session.add(
            FoodLogPhoto(
                food_log_id=log.id,
                content_type=content_type,
                byte_size=len(data),
                data=data,
            )
        )
    else:
        existing.content_type = content_type
        existing.byte_size = len(data)
        existing.data = data
    await session.commit()


async def get_photo(session: AsyncSession, user: User, log_id: uuid.UUID) -> FoodLogPhoto:
    # Goes through load_log first, so a meal belonging to someone else 404s on
    # the same path reading it does and never reveals that the id exists.
    await load_log(session, user.id, log_id)

    photo = await session.scalar(select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == log_id))
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No photo on that meal")
    return photo


async def delete_photo(session: AsyncSession, user: User, log_id: uuid.UUID) -> None:
    await load_log(session, user.id, log_id)
    photo = await session.scalar(select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == log_id))
    # Deleting a photo that is not there is the state the caller asked for, so
    # it is not an error.
    if photo is not None:
        await session.delete(photo)
        await session.commit()
