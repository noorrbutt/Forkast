"""Cuisines, categories, search and the restaurant registry."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError

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
from app.schemas.text import optional_text_field, text_field

router = APIRouter(tags=["catalog"])

# Trigram similarity below this is noise. 0.2 is loose enough to survive a
# genuine misspelling such as "biriani" for "Biryani".
SIMILARITY_THRESHOLD = 0.2


def _fuzzy(column, term: str):
    """A trigram match that the GIN indexes can actually serve.

    `similarity(col, term) > threshold` is not indexable: PostgreSQL has to
    compute it for every row. The `%` operator is the indexable form, so the
    threshold is set per statement and `%` does the filtering. similarity() is
    still used for ordering, where the cost is bounded by the rows `%` returned.
    """
    return column.op("%")(term)


async def _apply_similarity_threshold(session: SessionDep) -> None:
    """Set the threshold the % operator compares against, for this transaction.

    pg_trgm defaults to 0.3, which is tight enough to drop real misspellings:
    "biriani" against "Biryani" scores below it. SET LOCAL keeps the change
    scoped to this transaction so a pooled connection does not carry it into an
    unrelated request. The value is a module constant, never user input, so
    inlining it is safe.
    """
    await session.execute(text(f"SET LOCAL pg_trgm.similarity_threshold = {SIMILARITY_THRESHOLD}"))


# The characters LIKE treats as wildcards. Escaped rather than stripped, because
# a restaurant genuinely called "100% Chai" should still be findable by typing
# its name.
_LIKE_ESCAPE = "\\"


def _contains(term: str) -> str:
    """A LIKE pattern matching `term` anywhere, with its wildcards defused.

    Interpolating a raw term leaves % and _ live: q=%% matches every row in the
    table, which turns a typo-tolerant search box into a full table scan any
    unauthenticated-adjacent caller can trigger, and q=_ quietly matches far
    more than the single character the user typed. Callers must pass the result
    to .ilike(..., escape=_LIKE_ESCAPE) so PostgreSQL reads the escapes.
    """
    escaped = (
        term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", f"{_LIKE_ESCAPE}%")
        .replace("_", f"{_LIKE_ESCAPE}_")
    )
    return f"%{escaped}%"


@router.get("/cuisines", response_model=list[CuisineOut])
async def list_cuisines(session: SessionDep, user: CurrentUser) -> list[Cuisine]:
    result = await session.scalars(select(Cuisine).order_by(Cuisine.sort_order, Cuisine.name))
    return list(result)


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    session: SessionDep,
    user: CurrentUser,
    # Two spellings on purpose. cuisine_id is what the clients send and it
    # matches the response field, while the project plan's route table wrote
    # ?cuisine=. Declaring both as real parameters means a caller following
    # either one gets a filtered list instead of silently receiving everything.
    # AliasChoices is not used here: FastAPI ignores it on a Query parameter,
    # so the alternate spelling would quietly do nothing.
    cuisine_id: int | None = Query(default=None, ge=1, le=SMALLINT_MAX),
    cuisine: int | None = Query(default=None, ge=1, le=SMALLINT_MAX),
) -> list[FoodCategory]:
    selected = cuisine_id if cuisine_id is not None else cuisine

    stmt = select(FoodCategory).order_by(FoodCategory.name)
    if selected is not None:
        stmt = stmt.where(FoodCategory.cuisine_id == selected)
    result = await session.scalars(stmt)
    return list(result)


@router.get("/search", response_model=SearchResults)
async def search(
    session: SessionDep,
    user: CurrentUser,
    # text_field strips and rejects control characters before the length bound
    # runs, so a whitespace-only or NUL-bearing query is a 422 here rather than
    # a blank LIKE pattern or a 500 out of the database.
    q: Annotated[text_field(max_length=100), Query()],
    limit: int = Query(default=10, ge=1, le=50),
) -> SearchResults:
    """Typo tolerant search across cuisines, categories and the user's own dishes.

    Combines a prefix/substring match with pg_trgm similarity so that both
    "biry" and the misspelled "biriani" land on Biryani. Substring matches are
    ranked first because an exact fragment is a stronger signal than a fuzzy
    score.
    """
    await _apply_similarity_threshold(session)

    term = q
    pattern = _contains(term)

    cuisine_stmt = (
        select(Cuisine)
        .where(
            or_(
                Cuisine.name.ilike(pattern, escape=_LIKE_ESCAPE),
                _fuzzy(Cuisine.name, term),
            )
        )
        .order_by(
            Cuisine.name.ilike(pattern, escape=_LIKE_ESCAPE).desc(),
            func.similarity(Cuisine.name, term).desc(),
        )
        .limit(limit)
    )

    category_stmt = (
        select(FoodCategory)
        .where(
            or_(
                FoodCategory.name.ilike(pattern, escape=_LIKE_ESCAPE),
                _fuzzy(FoodCategory.name, term),
            )
        )
        .order_by(
            FoodCategory.name.ilike(pattern, escape=_LIKE_ESCAPE).desc(),
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
                FoodLog.dish_name.ilike(pattern, escape=_LIKE_ESCAPE),
                _fuzzy(FoodLog.dish_name, term),
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
    # A blank q folds to None, so "?q=   " lists rather than matching every
    # row through an empty LIKE pattern.
    q: Annotated[optional_text_field(max_length=100), Query()] = None,
    mine: bool = Query(
        default=False,
        description="Only restaurants this user has actually logged a meal at.",
    ),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[RestaurantOut]:
    """The registry is shared, so by default this lists every restaurant.

    That is right for the autocomplete on the log screen, where the point is to
    find a place someone else already added rather than create a duplicate. It
    is wrong for the map, which the brief calls a personal food heatmap: listing
    the whole registry there pins places the user has never been, and tells them
    which restaurants other people have been adding. `mine=true` narrows it to
    the ones they have actually logged a meal at.
    """
    stmt = select(Restaurant).order_by(Restaurant.name).limit(limit)
    if q:
        await _apply_similarity_threshold(session)
        term = q
        stmt = (
            select(Restaurant)
            .where(
                or_(
                    Restaurant.name.ilike(_contains(term), escape=_LIKE_ESCAPE),
                    _fuzzy(Restaurant.name, term),
                )
            )
            .order_by(
                Restaurant.name.ilike(_contains(term), escape=_LIKE_ESCAPE).desc(),
                func.similarity(Restaurant.name, term).desc(),
            )
            .limit(limit)
        )

    if mine:
        # An EXISTS rather than a join, so a restaurant visited fifty times
        # still comes back once and the ORDER BY does not need a DISTINCT.
        stmt = stmt.where(
            select(FoodLog.id)
            .where(FoodLog.restaurant_id == Restaurant.id, FoodLog.user_id == user.id)
            .exists()
        )

        # How many times, counted here rather than by the caller.
        #
        # The map draws these as totals, and it used to arrive at them by
        # counting a page of the hundred most recent logs. Past a hundred meals
        # that is simply a different number wearing the same label: a place
        # visited thirty times last year reads as zero, the busiest pin stops
        # being the busiest, and nothing on the screen says the figures are
        # partial. The database is the only place that can see the whole
        # history, so it is the only place the count can honestly come from.
        visits = (
            select(func.count(FoodLog.id))
            .where(FoodLog.restaurant_id == Restaurant.id, FoodLog.user_id == user.id)
            .correlate(Restaurant)
            .scalar_subquery()
        )
        rows = (await session.execute(stmt.add_columns(visits.label("visit_count")))).all()
        return [
            RestaurantOut.model_validate(restaurant).model_copy(update={"visit_count": count})
            for restaurant, count in rows
        ]

    result = await session.scalars(stmt)
    return [RestaurantOut.model_validate(restaurant) for restaurant in result]


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

    async def find() -> Restaurant | None:
        return await session.scalar(
            select(Restaurant).where(
                # func.lower on BOTH sides, never Python's str.lower on one of
                # them. They are not the same function: PostgreSQL lower() uses
                # the host OS libc character tables, so it may leave U+0130 (the
                # Turkish dotted capital I) and U+1E9E (capital sharp s) alone or
                # fold them differently. Python lower() folds U+0130 to 'i' plus a
                # combining dot and U+1E9E to U+00DF (ß). The unique index uses
                # PostgreSQL's lower(), so a Python folded lookup missed a row that
                # was already there, the insert below ran anyway, and the index
                # rejected it with an IntegrityError nothing caught. The second
                # person to log a meal at a restaurant with such a character in its
                # name got a 500 and lost the meal.
                func.lower(Restaurant.name) == func.lower(name.strip()),
                func.coalesce(func.lower(Restaurant.area), "") == func.lower(normalised_area or ""),
            )
        )

    existing = await find()
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
    try:
        # A SAVEPOINT, not the whole transaction. The insert below is allowed to
        # fail and be discarded; everything the caller did before calling here
        # is not.
        #
        # This used to be a plain session.rollback(), which throws away the
        # caller's entire transaction and, worse, expires every object loaded in
        # it. create_log loads the food category before it gets here and reads
        # the calorie range out of it afterwards, so on this path that read hit
        # an expired instance and tried to refresh it by emitting IO from a
        # plain attribute access, which in an async session is a MissingGreenlet
        # rather than anything that names the real problem. Two people adding
        # the same new restaurant at the same moment is the ordinary case this
        # branch exists for, so it has to leave the caller intact.
        async with session.begin_nested():
            session.add(restaurant)
            await session.flush()
    except IntegrityError:
        # The lookup above is not atomic, the same way register's is not. Two
        # people logging a meal at the same new restaurant at the same moment
        # both miss, and the index catches the loser. That is a shared registry
        # working correctly, not an error, so the loser adopts the row the
        # winner just made.
        found = await find()
        if found is None:
            raise
        return found, False

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
