"""Deduping a restaurant by name, when the name is not plain ASCII.

The registry is shared: everyone logging at the same place gets the same row, so
that the map and the per-restaurant totals mean anything. The dedupe was done by
comparing PostgreSQL's `lower()` on the stored column against Python's
`str.lower()` on the incoming name, which reads as the same comparison and is
not one.

They disagree on real characters. PostgreSQL leaves U+0130 (the Turkish dotted
capital I) and U+1E9E (capital sharp s) exactly as they are; Python folds the
first to 'i' plus a combining dot and the second to 'ss'. So the lookup missed a
row that was already there, the insert ran anyway, and the unique index on
lower(name) rejected it with an IntegrityError that nothing caught.

The user-visible result was a 500 and a lost meal for the second person to log
at such a restaurant, which the log form's autocomplete makes the likely case
rather than the unlikely one: the name comes back spelled exactly as stored.
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# Written as escapes rather than literals so the intent survives an editor or a
# terminal that cannot render them, which is how this class of bug hides.
DOTTED_CAPITAL_I = "\u0130"  # The Turkish dotted capital I
CAPITAL_SHARP_S = "\u1e9e"  # The capital sharp s

TRICKY_NAMES = [
    f"{DOTTED_CAPITAL_I}zmir Kebab",
    f"{CAPITAL_SHARP_S}uess Diner",
]


async def test_postgres_and_python_really_do_fold_these_differently(
    session: AsyncSession,
) -> None:
    """The premise of the rest of this file.

    If a future PostgreSQL or Python ever agrees on these, the tests below stop
    proving anything and this one says so rather than letting them pass for the
    wrong reason.
    """
    for name in TRICKY_NAMES:
        in_postgres = await session.scalar(select(func.lower(name)))
        assert in_postgres != name.lower(), (
            f"{name!r} now folds identically in both, so these tests are moot"
        )


async def test_logging_at_the_same_restaurant_twice_does_not_500(
    auth_client: AsyncClient,
) -> None:
    for name in TRICKY_NAMES:
        payload = {
            "dish_name": "Doner",
            "category_id": 1,
            "rating": 4,
            "serving_size": "medium",
            "restaurant_name": name,
            "area": "Testville",
        }

        first = await auth_client.post("/api/v1/logs", json=payload)
        assert first.status_code == 201, first.text

        # The identical body, the way the autocomplete would send it back.
        second = await auth_client.post("/api/v1/logs", json=payload)
        assert second.status_code == 201, second.text

        # And it is the same restaurant, not a duplicate row.
        assert (
            first.json()["restaurant"]["id"] == second.json()["restaurant"]["id"]
        ), f"{name!r} created a second row instead of reusing the first"


async def test_creating_the_same_restaurant_twice_returns_one_row(
    auth_client: AsyncClient,
) -> None:
    for name in TRICKY_NAMES:
        created = await auth_client.post(
            "/api/v1/restaurants", json={"name": name, "area": "Testville"}
        )
        assert created.status_code == 201, created.text

        again = await auth_client.post(
            "/api/v1/restaurants", json={"name": name, "area": "Testville"}
        )
        assert again.status_code == 200, again.text
        assert again.json()["id"] == created.json()["id"]


async def test_the_area_folds_the_same_way_as_the_name(auth_client: AsyncClient) -> None:
    """The area had the identical bug on the line below the name."""
    area = f"{DOTTED_CAPITAL_I}stanbul"

    created = await auth_client.post(
        "/api/v1/restaurants", json={"name": "Corner Grill", "area": area}
    )
    assert created.status_code == 201, created.text

    again = await auth_client.post(
        "/api/v1/restaurants", json={"name": "Corner Grill", "area": area}
    )
    assert again.status_code == 200, again.text
    assert again.json()["id"] == created.json()["id"]


async def test_plain_ascii_still_dedupes_case_insensitively(
    auth_client: AsyncClient,
) -> None:
    """The ordinary path, which was never broken and must not become so."""
    created = await auth_client.post(
        "/api/v1/restaurants", json={"name": "Burns Road Cafe", "area": "Saddar"}
    )
    again = await auth_client.post(
        "/api/v1/restaurants", json={"name": "  burns road CAFE", "area": "SADDAR"}
    )

    assert created.status_code == 201
    assert again.status_code == 200
    assert again.json()["id"] == created.json()["id"]
