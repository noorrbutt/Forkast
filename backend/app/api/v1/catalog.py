"""Cuisines, categories, search and the restaurant registry."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select

from app.api.deps import CurrentUser, SessionDep
from app.models import Cuisine, FoodCategory, FoodLog, Restaurant
from app.schemas.catalog import (
    SMALLINT_MAX,
    CategoryOut,
    CuisineOut,
    DishSuggestion,
    RestaurantCreate,
    RestaurantOut,
    SearchResults,
)

router = APIRouter(tags=["catalog"])

# Trigram similarity below this is noise. 0.2 is loose enough to survive a
# genuine misspelling such as "biriani" for "Biryani".
SIMILARITY_THRESHOLD = 0.2


@router.get("/cuisines", response_model=list[CuisineOut])
async def list_cuisines(session: SessionDep, user: CurrentUser) -> list[Cuisine]:
    result = await session.scalars(select(Cuisine).order_by(Cuisine.sort_order, Cuisine.name))
    return list(result)


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    session: SessionDep,
    user: CurrentUser,
    cuisine_id: int | None = Query(default=None, ge=1, le=SMALLINT_MAX),
) -> list[FoodCategory]:
    stmt = select(FoodCategory).order_by(FoodCategory.name)
    if cuisine_id is not None:
        stmt = stmt.where(FoodCategory.cuisine_id == cuisine_id)
    result = await session.scalars(stmt)
    return list(result)


@router.get("/search", response_model=SearchResults)
async def search(
    session: SessionDep,
    user: CurrentUser,
    q: str = Query(min_length=1, max_length=100),
    limit: int = Query(default=10, ge=1, le=50),
) -> SearchResults:
    """Typo tolerant search across cuisines, categories and the user's own dishes.

    Combines a prefix/substring match with pg_trgm similarity so that both
    "biry" and the misspelled "biriani" land on Biryani. Substring matches are
    ranked first because an exact fragment is a stronger signal than a fuzzy
    score.
    """
    term = q.strip()
    if not term:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Search query cannot be blank",
        )
    pattern = f"%{term}%"

    cuisine_stmt = (
        select(Cuisine)
        .where(
            or_(
                Cuisine.name.ilike(pattern),
                func.similarity(Cuisine.name, term) > SIMILARITY_THRESHOLD,
            )
        )
        .order_by(Cuisine.name.ilike(pattern).desc(), func.similarity(Cuisine.name, term).desc())
        .limit(limit)
    )

    category_stmt = (
        select(FoodCategory)
        .where(
            or_(
                FoodCategory.name.ilike(pattern),
                func.similarity(FoodCategory.name, term) > SIMILARITY_THRESHOLD,
            )
        )
        .order_by(
            FoodCategory.name.ilike(pattern).desc(),
            func.similarity(FoodCategory.name, term).desc(),
        )
        .limit(limit)
    )

    # Only the caller's own dish history, never anyone else's.
    dish_stmt = (
        select(FoodLog.dish_name, FoodLog.category_id)
        .where(
            FoodLog.user_id == user.id,
            or_(
                FoodLog.dish_name.ilike(pattern),
                func.similarity(FoodLog.dish_name, term) > SIMILARITY_THRESHOLD,
            ),
        )
        .group_by(FoodLog.dish_name, FoodLog.category_id)
        .order_by(func.max(FoodLog.created_at).desc())
        .limit(limit)
    )

    cuisines = list(await session.scalars(cuisine_stmt))
    categories = list(await session.scalars(category_stmt))
    dish_rows = (await session.execute(dish_stmt)).all()

    return SearchResults(
        cuisines=[CuisineOut.model_validate(c) for c in cuisines],
        categories=[CategoryOut.model_validate(c) for c in categories],
        dishes=[DishSuggestion(dish_name=name, category_id=cid) for name, cid in dish_rows],
    )


@router.get("/restaurants", response_model=list[RestaurantOut])
async def list_restaurants(
    session: SessionDep,
    user: CurrentUser,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[Restaurant]:
    stmt = select(Restaurant).order_by(Restaurant.name).limit(limit)
    if q:
        term = q.strip()
        stmt = (
            select(Restaurant)
            .where(
                or_(
                    Restaurant.name.ilike(f"%{term}%"),
                    func.similarity(Restaurant.name, term) > SIMILARITY_THRESHOLD,
                )
            )
            .order_by(
                Restaurant.name.ilike(f"%{term}%").desc(),
                func.similarity(Restaurant.name, term).desc(),
            )
            .limit(limit)
        )
    result = await session.scalars(stmt)
    return list(result)


async def upsert_restaurant(
    session: SessionDep,
    *,
    name: str,
    area: str | None,
    created_by,
    latitude=None,
    longitude=None,
) -> tuple[Restaurant, bool]:
    """Find a restaurant by case insensitive name and area, or create it.

    Returns (restaurant, created).

    Mirrors the uq_restaurants_name_area_lower index exactly, including the
    coalesce on area, so a lookup miss here means the insert will genuinely
    succeed rather than trip the constraint.
    """
    normalised_area = area.strip() if area and area.strip() else None

    existing = await session.scalar(
        select(Restaurant).where(
            func.lower(Restaurant.name) == name.strip().lower(),
            func.coalesce(func.lower(Restaurant.area), "") == (normalised_area or "").lower(),
        )
    )
    if existing is not None:
        # Backfill coordinates if this caller happens to know them.
        if latitude is not None and existing.latitude is None:
            existing.latitude = latitude
        if longitude is not None and existing.longitude is None:
            existing.longitude = longitude
        return existing, False

    restaurant = Restaurant(
        name=name.strip(),
        area=normalised_area,
        latitude=latitude,
        longitude=longitude,
        created_by=created_by,
    )
    session.add(restaurant)
    await session.flush()
    return restaurant, True


@router.post("/restaurants", response_model=RestaurantOut, status_code=status.HTTP_201_CREATED)
async def create_restaurant(
    payload: RestaurantCreate, session: SessionDep, user: CurrentUser, response: Response
) -> Restaurant:
    restaurant, created = await upsert_restaurant(
        session,
        name=payload.name,
        area=payload.area,
        created_by=user.id,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    await session.commit()
    # 201 only when a row was genuinely created. A deduped call is a successful
    # lookup, not a creation, and telling the client otherwise is misleading.
    if not created:
        response.status_code = status.HTTP_200_OK
    return restaurant
