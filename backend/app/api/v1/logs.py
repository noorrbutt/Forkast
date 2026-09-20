"""Food log CRUD, plus the month over month trend read.

This is the one feature area with real logic behind it. The trend lives here
rather than beside the dashboard because it is a straight read over food_logs
and nothing else, but it is not addressed under /logs, so this module exports
one router carrying both and the v1 aggregation stays a single include.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, RateLimiterDep, SessionDep
from app.api.v1.catalog import upsert_restaurant
from app.config import get_settings
from app.db import get_session_factory
from app.models import MAX_PHOTO_BYTES, FoodCategory, FoodLog, FoodLogPhoto, Restaurant
from app.models.enums import ServingSize
from app.schemas.insights import TrendOut
from app.schemas.logs import FoodLogCreate, FoodLogOut, FoodLogPage, FoodLogUpdate
from app.services.ai.base import AIService
from app.services.ai.deps import get_ai_service
from app.services.ai.groq_service import GroqResponseError
from app.services.ai.schemas import CalorieAdjustRequest
from app.services.calories import finalise_estimate
from app.services.insights import build_trend
from app.services.rate_limit import account_identity

logs_router = APIRouter(prefix="/logs", tags=["logs"])
trend_router = APIRouter(tags=["insights"])

# What app.api.v1 includes. Both of the above hang off it, so adding a route
# outside /logs needs no change to the aggregation.
router = APIRouter()

AIDep = Annotated[AIService, Depends(get_ai_service)]

# Injected rather than imported, for the reason get_session_factory's own
# docstring gives: it is a dependency precisely so tests can point it at the
# test database. Calling it directly from a background task would step past
# app.dependency_overrides and open a connection to the real one.
SessionFactoryDep = Annotated["async_sessionmaker[AsyncSession]", Depends(get_session_factory)]

logger = logging.getLogger(__name__)


def _provisional_estimate(category: FoodCategory, serving_size: ServingSize) -> int:
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


async def _refine_estimate(
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

        refined = await _estimate_calories(
            ai,
            dish_name=dish_name,
            category_name=category_name,
            base_calorie_min=base_calorie_min,
            base_calorie_max=base_calorie_max,
            serving_size=serving_size,
        )

        async with factory() as session:
            log = await session.get(FoodLog, log_id)
            if log is None or log.category_id != category_id:
                return
            if refined != log.estimated_calories:
                log.estimated_calories = refined
                await session.commit()
    except Exception:
        logger.warning("Could not refine the estimate for log %s", log_id, exc_info=True)


async def _get_category(session: SessionDep, category_id: int) -> FoodCategory:
    category = await session.get(FoodCategory, category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown category_id {category_id}",
        )
    return category


async def _require_restaurant(session: SessionDep, restaurant_id: uuid.UUID | None) -> None:
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


async def _estimate_calories(
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The calorie estimator is unavailable: {exc}",
        ) from exc
    return finalise_estimate(
        adjustment.calories,
        base_calorie_min,
        base_calorie_max,
        serving_size,
    )


async def _load_log(session: SessionDep, user_id: uuid.UUID, log_id: uuid.UUID) -> FoodLog:
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


@logs_router.post("", response_model=FoodLogOut, status_code=status.HTTP_201_CREATED)
async def create_log(
    payload: FoodLogCreate,
    session: SessionDep,
    user: CurrentUser,
    ai: AIDep,
    factory: SessionFactoryDep,
    background: BackgroundTasks,
    limiter: RateLimiterDep,
) -> FoodLog:
    settings = get_settings()
    await limiter.hit(
        "log-day",
        account_identity(user.id),
        limit=settings.log_daily_limit,
        window_seconds=86400,
    )
    category = await _get_category(session, payload.category_id)

    restaurant_id = payload.restaurant_id
    await _require_restaurant(session, restaurant_id)
    if payload.restaurant_name:
        await limiter.hit(
            "restaurant-day",
            account_identity(user.id),
            limit=settings.restaurant_daily_limit,
            window_seconds=86400,
        )
        restaurant, _ = await upsert_restaurant(
            session,
            name=payload.restaurant_name,
            area=payload.area,
            created_by=user.id,
        )
        restaurant_id = restaurant.id

    # Saved with a figure that needs nobody's permission, and refined behind
    # the response. See _provisional_estimate.
    estimated = _provisional_estimate(category, payload.serving_size)

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
    )
    if payload.created_at is not None:
        log.created_at = payload.created_at

    session.add(log)
    await session.flush()
    created = await _load_log(session, user.id, log.id)
    await session.commit()
    # After the commit, so the row is certainly there when the task opens its
    # own session, and after the response is built, so nobody waits for it.
    background.add_task(_refine_estimate, created.id, created.category_id, ai, factory)
    return created


@logs_router.get("", response_model=FoodLogPage)
async def list_logs(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> FoodLogPage:
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
    return FoodLogPage(
        items=[FoodLogOut.model_validate(row) for row in rows],
        total=total or 0,
    )


@logs_router.get("/{log_id}", response_model=FoodLogOut)
async def get_log(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> FoodLog:
    return await _load_log(session, user.id, log_id)


@logs_router.patch("/{log_id}", response_model=FoodLogOut)
async def update_log(
    log_id: uuid.UUID,
    payload: FoodLogUpdate,
    session: SessionDep,
    user: CurrentUser,
    ai: AIDep,
    factory: SessionFactoryDep,
    background: BackgroundTasks,
    limiter: RateLimiterDep,
) -> FoodLog:
    log = await _load_log(session, user.id, log_id)
    changes = payload.model_dump(exclude_unset=True)

    if "category_id" in changes:
        await _get_category(session, changes["category_id"])
    if "restaurant_id" in changes:
        await _require_restaurant(session, changes["restaurant_id"])

    for field, value in changes.items():
        setattr(log, field, value)

    # Anything that feeds the estimate means the estimate has to be redone,
    # otherwise the stored calories quietly stop matching the log.
    refine = bool({"dish_name", "category_id", "serving_size"} & changes.keys())
    if refine:
        category = await _get_category(session, log.category_id)
        log.estimated_calories = _provisional_estimate(category, log.serving_size)

    await session.flush()
    updated = await _load_log(session, user.id, log.id)
    await session.commit()
    if refine:
        settings = get_settings()
        try:
            await limiter.hit(
                "refine",
                account_identity(user.id),
                limit=settings.refine_rate_limit,
                window_seconds=3600,
            )
        except HTTPException as exc:
            if exc.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
                raise
        else:
            background.add_task(_refine_estimate, updated.id, updated.category_id, ai, factory)
    return updated


@logs_router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_log(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    log = await _load_log(session, user.id, log_id)
    await session.delete(log)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@logs_router.post(
    "/{log_id}/repeat", response_model=FoodLogOut, status_code=status.HTTP_201_CREATED
)
async def repeat_log(
    log_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    limiter: RateLimiterDep,
) -> FoodLog:
    """Log the same thing again, now, without retyping any of it.

    A new row rather than a counter on the old one: two chai at nine and at four
    are two meals on two parts of the day, and collapsing them would flatten the
    calorie chart and the streak alike.
    """
    settings = get_settings()
    await limiter.hit(
        "log-day",
        account_identity(user.id),
        limit=settings.log_daily_limit,
        window_seconds=86400,
    )
    original = await _load_log(session, user.id, log_id)

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
    )
    # created_at is deliberately left to the column default. That is the whole
    # point of a repeat: same meal, this moment.
    session.add(repeated)
    await session.flush()

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
    relationship is lazy="raise_on_sql" and _load_log does not eager load it, so
    touching the attribute raises instead of quietly issuing a query.
    """
    photo = await session.scalar(
        select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == original.id)
    )
    if photo is not None:
        session.add(
            FoodLogPhoto(
                food_log_id=repeated.id,
                content_type=photo.content_type,
                byte_size=photo.byte_size,
                data=photo.data,
            )
        )
        await session.flush()

    created = await _load_log(session, user.id, repeated.id)
    await session.commit()
    return created


# What a phone camera and an image picker actually produce. Checked by magic
# bytes rather than by the declared content type, because the header is whatever
# the client says it is and this content is served straight back to other users
# of the same account.
# Written as hex rather than as escaped byte strings. These signatures
# contain CR, LF and SUB, which do not survive being copied through a text
# editor intact, and a silently mangled signature here would reject every
# valid PNG.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (bytes.fromhex("ffd8ff"), "image/jpeg"),
    (bytes.fromhex("89504e470d0a1a0a"), "image/png"),
    (bytes.fromhex("52494646"), "image/webp"),
)


def _sniff(data: bytes) -> str | None:
    """The real type of these bytes, or None if it is not an image we accept."""
    for prefix, content_type in _MAGIC:
        if not data.startswith(prefix):
            continue
        # RIFF alone is any RIFF container, including audio. Only WEBP counts.
        if content_type == "image/webp" and data[8:12] != bytes.fromhex("57454250"):
            return None
        return content_type
    return None


@logs_router.put("/{log_id}/photo", response_model=FoodLogOut)
async def set_photo(
    log_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
    limiter: RateLimiterDep,
) -> FoodLog:
    """Attach or replace the picture on a meal.

    PUT rather than POST: there is one photo per meal, so uploading twice leaves
    the same state instead of stacking a second image. A retry after a dropped
    connection is then safe by construction.
    """
    settings = get_settings()
    await limiter.hit(
        "photo-day",
        account_identity(user.id),
        limit=settings.photo_daily_limit,
        window_seconds=86400,
    )
    log = await _load_log(session, user.id, log_id)

    # Read with one byte of headroom so a file on the limit passes and anything
    # over it is caught here rather than by the CHECK constraint, which would
    # surface as a 500.
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Photos must be {MAX_PHOTO_BYTES // 1024} KB or smaller.",
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That file was empty.",
        )

    content_type = _sniff(data)
    if content_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Photos must be JPEG, PNG or WebP.",
        )

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
    return await _load_log(session, user.id, log_id)


@logs_router.get("/{log_id}/photo")
async def get_photo(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    """The image bytes.

    Deliberately returns the file rather than a URL. That keeps the storage
    decision behind this route: moving the bytes to object storage later becomes
    a redirect from here, and no client changes.
    """
    # Goes through _load_log first, so a meal belonging to someone else 404s on
    # the same path reading it does and never reveals that the id exists.
    await _load_log(session, user.id, log_id)

    photo = await session.scalar(select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == log_id))
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No photo on that meal")

    return Response(
        content=photo.data,
        media_type=photo.content_type,
        headers={
            # The bytes for a given photo never change; a replacement is a new
            # row with a new id, so this is safe to hold onto.
            "Cache-Control": "private, max-age=86400",
            "Content-Length": str(photo.byte_size),
        },
    )


@logs_router.delete("/{log_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    await _load_log(session, user.id, log_id)
    photo = await session.scalar(select(FoodLogPhoto).where(FoodLogPhoto.food_log_id == log_id))
    # Deleting a photo that is not there is the state the caller asked for, so
    # it is not an error.
    if photo is not None:
        await session.delete(photo)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@trend_router.get("/trend", response_model=TrendOut)
async def trend(session: SessionDep, user: CurrentUser) -> TrendOut:
    return await build_trend(session, user)


router.include_router(logs_router)
router.include_router(trend_router)
