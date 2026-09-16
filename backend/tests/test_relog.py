"""Repeating a past log in one tap.

The route is a pure copy: read one row the caller owns, write another describing
the same meal with a fresh timestamp. Most of what is worth testing is what it
must not do, namely re-estimate the calories, reach across users or disturb the
row it copied.
"""

from __future__ import annotations

import datetime as dt
import uuid

from httpx import AsyncClient

from app.main import app
from app.services.ai.deps import get_ai_service

LOGS = "/api/v1/logs"
DASHBOARD = "/api/v1/dashboard"


class _ExplodingEstimator:
    """A stand-in for the AI seam where every method is a tripwire.

    Implements the same two calls as the real service, so resolving it proves
    nothing; the point is that a repeat must never reach either of them.
    """

    async def adjust_calories(self, request):
        raise AssertionError("a repeat re-estimated the calories instead of copying them")

    async def generate_plan(self, request):
        raise AssertionError("a repeat called the planner")


async def _a_category(client: AsyncClient, slug: str = "biryani") -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    return next(c for c in categories if c["slug"] == slug)


async def _log(client: AsyncClient, category: dict, **overrides) -> dict:
    payload: dict = {
        "dish_name": "chicken biryani",
        "category_id": category["id"],
        "rating": 5,
        "serving_size": "medium",
    }
    payload.update(overrides)
    response = await client.post(LOGS, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _repeat(client: AsyncClient, log_id: str) -> dict:
    response = await client.post(f"{LOGS}/{log_id}/repeat")
    assert response.status_code == 201, response.text
    return response.json()


async def test_repeating_a_log_writes_a_second_row_for_the_same_dish(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    original = await _log(auth_client, category, dish_name="nihari")

    repeated = await _repeat(auth_client, original["id"])

    assert repeated["id"] != original["id"], "a repeat is a new meal, not an edit"
    assert repeated["dish_name"] == "nihari"
    assert (await auth_client.get(LOGS)).json()["total"] == 2


async def test_a_repeat_carries_over_everything_that_describes_the_meal(
    auth_client: AsyncClient,
) -> None:
    """The whole point is not retyping, so nothing the user chose may be lost."""
    category = await _a_category(auth_client, "karahi")
    original = await _log(
        auth_client,
        category,
        dish_name="chicken karahi",
        restaurant_name="Kolachi",
        area="Do Darya",
        rating=4,
        fun_scale=5,
        friend_scale="squad",
        serving_size="large",
    )

    repeated = await _repeat(auth_client, original["id"])

    described = ("dish_name", "category_id", "restaurant_id", "area", "rating",
                 "fun_scale", "friend_scale", "serving_size")
    assert {key: repeated[key] for key in described} == {key: original[key] for key in described}
    # The joined objects have to come back too, or the client has to refetch the
    # row it just created before it can render it.
    assert repeated["restaurant"]["name"] == "Kolachi"
    assert repeated["category"]["slug"] == "karahi"


async def test_a_repeat_is_stamped_now_rather_than_with_the_originals_time(
    auth_client: AsyncClient,
) -> None:
    """A repeat that inherited the old timestamp would land on the old day and
    be invisible on today's chart."""
    category = await _a_category(auth_client)
    three_days_ago = dt.datetime.now(dt.UTC) - dt.timedelta(days=3)
    original = await _log(auth_client, category, created_at=three_days_ago.isoformat())

    before = dt.datetime.now(dt.UTC)
    repeated = await _repeat(auth_client, original["id"])
    after = dt.datetime.now(dt.UTC)

    stamped = dt.datetime.fromisoformat(repeated["created_at"])
    assert stamped > dt.datetime.fromisoformat(original["created_at"])
    # Bracketed by the call itself rather than compared to a tolerance, so a
    # server clock in the wrong zone fails here instead of passing by luck.
    assert before - dt.timedelta(seconds=5) <= stamped <= after + dt.timedelta(seconds=5)


async def test_a_repeat_copies_the_estimate_instead_of_asking_the_model_again(
    auth_client: AsyncClient,
) -> None:
    """Same dish, same category, same serving size, so the estimate is already
    known. Asking again costs money, adds latency and, with a real model behind
    the seam, can quote the user two figures for one meal."""
    category = await _a_category(auth_client)
    original = await _log(auth_client, category, dish_name="chicken alfredo")

    app.dependency_overrides[get_ai_service] = _ExplodingEstimator
    repeated = await _repeat(auth_client, original["id"])

    assert repeated["estimated_calories"] == original["estimated_calories"]


async def test_a_repeat_leaves_the_original_alone(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)
    original = await _log(auth_client, category, dish_name="haleem")

    await _repeat(auth_client, original["id"])

    assert (await auth_client.get(f"{LOGS}/{original['id']}")).json() == original


async def test_a_repeat_counts_as_another_meal_on_the_dashboard(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    original = await _log(auth_client, category)

    await _repeat(auth_client, original["id"])

    body = (await auth_client.get(DASHBOARD)).json()
    assert body["logs_count"] == 2
    assert body["total_calories"] == original["estimated_calories"] * 2


async def test_a_repeat_can_itself_be_repeated(auth_client: AsyncClient) -> None:
    """Someone who eats the same thing every day repeats yesterday's repeat, so
    the copy has to be as repeatable as the row it came from."""
    category = await _a_category(auth_client)
    original = await _log(auth_client, category, dish_name="daal chawal")

    once = await _repeat(auth_client, original["id"])
    twice = await _repeat(auth_client, once["id"])

    assert twice["dish_name"] == "daal chawal"
    assert len({original["id"], once["id"], twice["id"]}) == 3
    assert (await auth_client.get(LOGS)).json()["total"] == 3


async def test_repeating_a_log_that_does_not_exist_is_a_404(auth_client: AsyncClient) -> None:
    response = await auth_client.post(f"{LOGS}/{uuid.uuid4()}/repeat")

    assert response.status_code == 404


async def test_repeating_a_deleted_log_is_a_404(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)
    original = await _log(auth_client, category)
    assert (await auth_client.delete(f"{LOGS}/{original['id']}")).status_code == 204

    assert (await auth_client.post(f"{LOGS}/{original['id']}/repeat")).status_code == 404


async def test_repeating_without_a_token_is_rejected(client: AsyncClient) -> None:
    assert (await client.post(f"{LOGS}/{uuid.uuid4()}/repeat")).status_code == 401


async def test_one_user_cannot_repeat_another_users_log(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register", json={"email": "r1@forkast.app", "password": "password123"}
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register", json={"email": "r2@forkast.app", "password": "password123"}
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

    # 404 rather than 403, exactly as GET /logs/{id} does: there is no reason to
    # confirm the id exists.
    response = await client.post(f"{LOGS}/{created['id']}/repeat", headers=stranger_headers)

    assert response.status_code == 404
    # And nothing was written into either account on the way to that answer.
    assert (await client.get(LOGS, headers=stranger_headers)).json()["total"] == 0
    assert (await client.get(LOGS, headers=owner_headers)).json()["total"] == 1
