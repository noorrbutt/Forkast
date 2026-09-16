"""Food log CRUD, plus the month over month trend read.

This is the one feature area with real logic behind it. The trend lives here
rather than beside the dashboard because it is a straight read over food_logs
and nothing else, but it is not addressed under /logs, so this module exports
one router carrying both and the v1 aggregation stays a single include.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.api.v1.catalog import upsert_restaurant
from app.models import FoodCategory, FoodLog, Restaurant
from app.schemas.insights import TrendOut
from app.schemas.logs import FoodLogCreate, FoodLogOut, FoodLogPage, FoodLogUpdate
from app.services.ai.base import AIService
from app.services.ai.deps import get_ai_service
from app.services.ai.groq_service import GroqResponseError
from app.services.ai.schemas import CalorieAdjustRequest
from app.services.calories import finalise_estimate
from app.services.insights import build_trend

logs_router = APIRouter(prefix="/logs", tags=["logs"])
trend_router = APIRouter(tags=["insights"])

# What app.api.v1 includes. Both of the above hang off it, so adding a route
# outside /logs needs no change to the aggregation.
router = APIRouter()

AIDep = Annotated[AIService, Depends(get_ai_service)]


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
    ai: AIService, category: FoodCategory, dish_name: str, serving_size
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
                category_name=category.name,
                base_calorie_min=category.base_calorie_min,
                base_calorie_max=category.base_calorie_max,
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
        category.base_calorie_min,
        category.base_calorie_max,
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
    payload: FoodLogCreate, session: SessionDep, user: CurrentUser, ai: AIDep
) -> FoodLog:
    category = await _get_category(session, payload.category_id)

    restaurant_id = payload.restaurant_id
    await _require_restaurant(session, restaurant_id)
    if payload.restaurant_name:
        restaurant, _ = await upsert_restaurant(
            session,
            name=payload.restaurant_name,
            area=payload.area,
            created_by=user.id,
        )
        restaurant_id = restaurant.id

    estimated = await _estimate_calories(ai, category, payload.dish_name, payload.serving_size)

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
    if {"dish_name", "category_id", "serving_size"} & changes.keys():
        category = await _get_category(session, log.category_id)
        log.estimated_calories = await _estimate_calories(
            ai, category, log.dish_name, log.serving_size
        )

    await session.flush()
    updated = await _load_log(session, user.id, log.id)
    await session.commit()
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
async def repeat_log(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> FoodLog:
    """Log the same thing again, now, without retyping any of it.

    A new row rather than a counter on the old one: two chai at nine and at four
    are two meals on two parts of the day, and collapsing them would flatten the
    calorie chart and the streak alike.
    """
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
    created = await _load_log(session, user.id, repeated.id)
    await session.commit()
    return created


@trend_router.get("/trend", response_model=TrendOut)
async def trend(session: SessionDep, user: CurrentUser) -> TrendOut:
    return await build_trend(session, user)


router.include_router(logs_router)
router.include_router(trend_router)
