"""Food log CRUD, calorie estimation and per user isolation."""

from __future__ import annotations

import asyncio
import datetime as dt

import pytest
from httpx import AsyncClient

LOGS = "/api/v1/logs"


async def _a_category(client: AsyncClient, slug: str = "biryani") -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    return next(c for c in categories if c["slug"] == slug)


async def test_creating_a_log_stores_it_and_estimates_calories(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "chicken biryani",
            "category_id": category["id"],
            "rating": 5,
            "fun_scale": 4,
            "friend_scale": "squad",
            "serving_size": "medium",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["dish_name"] == "chicken biryani"
    assert body["friend_scale"] == "squad"
    # A medium serving is a 1.0 multiplier, so the estimate must land inside the
    # category's own range.
    assert (
        category["base_calorie_min"] <= body["estimated_calories"] <= category["base_calorie_max"]
    )
    assert body["category"]["slug"] == "biryani"


async def test_serving_size_scales_the_estimate(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)

    def payload(serving: str) -> dict:
        return {
            "dish_name": "chicken biryani",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": serving,
        }

    small = (await auth_client.post(LOGS, json=payload("small"))).json()
    medium = (await auth_client.post(LOGS, json=payload("medium"))).json()
    large = (await auth_client.post(LOGS, json=payload("large"))).json()

    assert small["estimated_calories"] < medium["estimated_calories"]
    assert medium["estimated_calories"] < large["estimated_calories"]
    # A large portion is allowed to exceed the category maximum: the clamp
    # applies to the AI's in-range figure, not to the scaled result.
    assert large["estimated_calories"] > category["base_calorie_max"] * 0.99


async def test_the_estimate_is_deterministic(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)
    payload = {
        "dish_name": "chicken alfredo",
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
    }

    first = (await auth_client.post(LOGS, json=payload)).json()
    second = (await auth_client.post(LOGS, json=payload)).json()

    assert first["estimated_calories"] == second["estimated_calories"]


async def test_a_restaurant_name_is_deduped_into_the_registry(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)

    def payload(name: str) -> dict:
        return {
            "dish_name": "chicken biryani",
            "category_id": category["id"],
            "restaurant_name": name,
            "area": "Clifton",
            "rating": 4,
            "serving_size": "medium",
        }

    first = (await auth_client.post(LOGS, json=payload("Student Biryani"))).json()
    # Different casing and trailing space must collapse onto the same row.
    second = (await auth_client.post(LOGS, json=payload("student biryani "))).json()

    assert first["restaurant_id"] is not None
    assert first["restaurant_id"] == second["restaurant_id"]

    restaurants = (await auth_client.get("/api/v1/restaurants")).json()
    assert len([r for r in restaurants if r["name"].lower() == "student biryani"]) == 1


async def test_a_log_can_be_created_without_a_restaurant(auth_client: AsyncClient) -> None:
    """A home cooked meal must never be blocked from being logged."""
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "daal chawal at home",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )

    assert response.status_code == 201
    assert response.json()["restaurant_id"] is None


async def test_restaurant_id_and_name_together_are_rejected(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "biryani",
            "category_id": category["id"],
            "restaurant_id": "00000000-0000-0000-0000-000000000000",
            "restaurant_name": "Somewhere",
            "rating": 4,
            "serving_size": "medium",
        },
    )

    assert response.status_code == 422


async def test_an_unknown_category_is_rejected(auth_client: AsyncClient) -> None:
    response = await auth_client.post(
        LOGS,
        json={"dish_name": "mystery", "category_id": 99999, "rating": 4, "serving_size": "medium"},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("rating", [0, 6, -1])
async def test_rating_must_be_between_one_and_five(auth_client: AsyncClient, rating: int) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "biryani",
            "category_id": category["id"],
            "rating": rating,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 422


async def test_listing_logs_is_newest_first_and_paginated(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)
    for index in range(5):
        await auth_client.post(
            LOGS,
            json={
                "dish_name": f"dish {index}",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )

    page = (await auth_client.get(LOGS, params={"limit": 2})).json()

    assert page["total"] == 5
    assert len(page["items"]) == 2
    timestamps = [item["created_at"] for item in page["items"]]
    assert timestamps == sorted(timestamps, reverse=True)


async def test_editing_the_serving_size_recalculates_the_estimate(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "chicken biryani",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "small",
            },
        )
    ).json()

    updated = (
        await auth_client.patch(f"{LOGS}/{created['id']}", json={"serving_size": "large"})
    ).json()

    assert updated["serving_size"] == "large"
    assert updated["estimated_calories"] > created["estimated_calories"]


async def test_a_slow_refine_does_not_overwrite_a_newer_serving_size_edit(
    auth_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    category = await _a_category(auth_client)
    release = asyncio.Event()

    async def delayed_estimate(*, dish_name: str, category_name: str, serving_size, **kwargs):
        await release.wait()
        return 9999

    monkeypatch.setattr("app.api.v1.logs._estimate_calories", delayed_estimate)

    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "chicken biryani",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "small",
            },
        )
    ).json()

    await asyncio.sleep(0.05)
    updated = (
        await auth_client.patch(f"{LOGS}/{created['id']}", json={"serving_size": "large"})
    ).json()

    assert updated["serving_size"] == "large"
    release.set()
    await asyncio.sleep(0.05)

    final = (await auth_client.get(f"{LOGS}/{created['id']}")).json()
    assert final["serving_size"] == "large"
    assert final["estimated_calories"] == updated["estimated_calories"]


async def test_editing_only_the_rating_leaves_the_estimate_alone(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    posted = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "chicken biryani",
                "category_id": category["id"],
                "rating": 3,
                "serving_size": "medium",
            },
        )
    ).json()
    # Read back rather than taken from the 201 body. Saving does not wait on the
    # calorie model any more: the row is written with the category midpoint, the
    # response goes out, and the refinement lands behind it. The point of this
    # test is that editing the rating changes nothing, so the figure it compares
    # against has to be the settled one.
    created = (await auth_client.get(f"{LOGS}/{posted['id']}")).json()

    updated = (await auth_client.patch(f"{LOGS}/{created['id']}", json={"rating": 5})).json()

    assert updated["rating"] == 5
    assert updated["estimated_calories"] == created["estimated_calories"]


async def test_a_log_can_be_fetched_and_deleted(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "nihari",
                "category_id": category["id"],
                "rating": 5,
                "serving_size": "medium",
            },
        )
    ).json()

    assert (await auth_client.get(f"{LOGS}/{created['id']}")).status_code == 200
    assert (await auth_client.delete(f"{LOGS}/{created['id']}")).status_code == 204
    assert (await auth_client.get(f"{LOGS}/{created['id']}")).status_code == 404


async def test_one_user_cannot_see_or_touch_another_users_log(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "owner@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "stranger@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    owner_headers = {"Authorization": f"Bearer {first['access_token']}"}
    stranger_headers = {"Authorization": f"Bearer {second['access_token']}"}

    categories = (await client.get("/api/v1/categories", headers=owner_headers)).json()
    created = (
        await client.post(
            LOGS,
            headers=owner_headers,
            json={
                "dish_name": "private meal",
                "category_id": categories[0]["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
    ).json()

    # 404 rather than 403: there is no reason to confirm the id exists.
    assert (
        await client.get(f"{LOGS}/{created['id']}", headers=stranger_headers)
    ).status_code == 404
    assert (
        await client.delete(f"{LOGS}/{created['id']}", headers=stranger_headers)
    ).status_code == 404
    assert (await client.get(LOGS, headers=stranger_headers)).json()["total"] == 0


async def test_an_unknown_restaurant_id_is_rejected(auth_client: AsyncClient) -> None:
    """Without validation the value reaches the foreign key and returns a 500."""
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "ghost restaurant",
            "category_id": category["id"],
            "restaurant_id": "00000000-0000-0000-0000-000000000000",
            "rating": 4,
            "serving_size": "medium",
        },
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["dish_name", "category_id", "rating", "serving_size"])
async def test_patching_a_non_nullable_field_to_null_is_a_client_error(
    auth_client: AsyncClient, field: str
) -> None:
    """Omitting a field means leave it alone. Sending an explicit null is a
    mistake, and used to reach the database and return a 500."""
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "nullable probe",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
    ).json()

    response = await auth_client.patch(f"{LOGS}/{created['id']}", json={field: None})

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["fun_scale", "friend_scale", "area"])
async def test_patching_a_nullable_field_to_null_still_clears_it(
    auth_client: AsyncClient, field: str
) -> None:
    """The guard above must not block legitimately clearing an optional field."""
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "clearable",
                "category_id": category["id"],
                "rating": 4,
                "fun_scale": 5,
                "friend_scale": "squad",
                "area": "Clifton",
                "serving_size": "medium",
            },
        )
    ).json()

    response = await auth_client.patch(f"{LOGS}/{created['id']}", json={field: None})

    assert response.status_code == 200
    assert response.json()[field] is None


async def test_patching_the_category_returns_the_new_nested_category(
    auth_client: AsyncClient,
) -> None:
    """The response has to be internally consistent.

    Assigning a raw foreign key does not refresh the relationship loaded beside
    it, and a plain reload resolves to the same identity-mapped object without
    overwriting it, so the response used to carry the new category_id next to
    the old nested category. A client rendering the nested object showed the
    wrong category until something else refetched.
    """
    biryani = await _a_category(auth_client, "biryani")
    pizza = await _a_category(auth_client, "pizza")

    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "switcher",
                "category_id": biryani["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
    ).json()
    assert created["category"]["slug"] == "biryani"

    patched = (
        await auth_client.patch(f"{LOGS}/{created['id']}", json={"category_id": pizza["id"]})
    ).json()

    assert patched["category_id"] == pizza["id"]
    assert patched["category"]["slug"] == "pizza", "nested category is stale"


async def test_patching_the_restaurant_returns_the_new_nested_restaurant(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    first = (await auth_client.post("/api/v1/restaurants", json={"name": "Nested One"})).json()
    second = (await auth_client.post("/api/v1/restaurants", json={"name": "Nested Two"})).json()

    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "moving",
                "category_id": category["id"],
                "restaurant_id": first["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
    ).json()

    patched = (
        await auth_client.patch(f"{LOGS}/{created['id']}", json={"restaurant_id": second["id"]})
    ).json()

    assert patched["restaurant"]["name"] == "Nested Two"


async def test_a_backfilled_timestamp_must_carry_an_offset(auth_client: AsyncClient) -> None:
    """A naive datetime is encoded against the API host's zone, not the user's,
    so the same payload would land on a different calendar day depending on
    where the server runs. Streaks bucket by local day."""
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "naive backfill",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
            "created_at": "2026-09-01T20:30:00",
        },
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "offset_days",
    [4000, -1],
    ids=["implausibly old", "in the future"],
)
async def test_an_implausible_backfill_timestamp_is_rejected(
    auth_client: AsyncClient, offset_days: int
) -> None:
    category = await _a_category(auth_client)
    when = dt.datetime.now(dt.UTC) - dt.timedelta(days=offset_days)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "time traveller",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
            "created_at": when.isoformat(),
        },
    )

    assert response.status_code == 422


async def test_a_reasonable_backfill_is_accepted(auth_client: AsyncClient) -> None:
    """Logging a meal you forgot about yesterday has to keep working."""
    category = await _a_category(auth_client)
    yesterday = dt.datetime.now(dt.UTC) - dt.timedelta(days=1)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "yesterday lunch",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
            "created_at": yesterday.isoformat(),
        },
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "field",
    ["dish_name", "restaurant_name", "area"],
)
async def test_a_nul_byte_in_any_text_field_is_a_client_error(
    auth_client: AsyncClient, field: str
) -> None:
    """PostgreSQL text cannot hold \x00.

    Before the shared text validator this reached asyncpg and came back as a
    500 CharacterNotInRepertoireError, taking the pooled connection with it.
    """
    category = await _a_category(auth_client)
    payload = {
        "dish_name": "nul test",
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
        field: "bad\x00value",
    }

    response = await auth_client.post(LOGS, json=payload)

    assert response.status_code == 422, response.text


async def test_a_whitespace_only_dish_name_is_rejected_not_stored_empty(
    auth_client: AsyncClient,
) -> None:
    """min_length counted the raw string, so "   " passed it and the handler's
    strip() then wrote an empty dish_name to a NOT NULL column."""
    category = await _a_category(auth_client)

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "   ",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )

    assert response.status_code == 422, response.text


async def test_surrounding_whitespace_is_trimmed_on_create_and_on_update(
    auth_client: AsyncClient,
) -> None:
    """Create stripped dish_name and PATCH did not, so editing a log could
    reintroduce padding that creating one could not."""
    category = await _a_category(auth_client)

    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "  chicken biryani  ",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "medium",
                "area": "  Clifton  ",
            },
        )
    ).json()
    assert created["dish_name"] == "chicken biryani"
    assert created["area"] == "Clifton"

    updated = (
        await auth_client.patch(f"{LOGS}/{created['id']}", json={"dish_name": "  mutton biryani  "})
    ).json()
    assert updated["dish_name"] == "mutton biryani"


async def test_blanking_an_optional_field_clears_it(auth_client: AsyncClient) -> None:
    """A user emptying the area box means "no area", not the empty string."""
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "biryani",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "medium",
                "area": "Clifton",
            },
        )
    ).json()

    updated = (await auth_client.patch(f"{LOGS}/{created['id']}", json={"area": "   "})).json()

    assert updated["area"] is None


async def test_a_whitespace_only_restaurant_name_does_not_create_a_nameless_row(
    auth_client: AsyncClient,
) -> None:
    """It used to create a restaurant called "", which then deduped every
    other blank-named submission onto the same junk row."""
    category = await _a_category(auth_client)

    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "home cooked",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "medium",
                "restaurant_name": "   ",
            },
        )
    ).json()

    assert created["restaurant_id"] is None
    assert created["restaurant"] is None
