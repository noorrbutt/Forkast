"""Profile and AI plans.

Dashboard and streak behaviour lives in test_dashboard_and_streaks.py; only the
"no sample-data marker survives" check stays here, because it is about the shape
of the response rather than about aggregation.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.config import get_settings


async def _log_pizza(client: AsyncClient) -> None:
    categories = (await client.get("/api/v1/categories")).json()
    pizza = next(c for c in categories if c["slug"] == "pizza")
    response = await client.post(
        "/api/v1/logs",
        json={
            "dish_name": "pepperoni pizza",
            "category_id": pizza["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 201, response.text


async def test_profile_returns_the_current_user(auth_client: AsyncClient) -> None:
    body = (await auth_client.get("/api/v1/me")).json()

    assert body["email"] == "fixture@forkast.app"
    assert body["goal"] == "maintain"


async def test_goal_and_timezone_can_be_updated(auth_client: AsyncClient) -> None:
    updated = (
        await auth_client.patch("/api/v1/me", json={"goal": "cut", "timezone": "Asia/Dubai"})
    ).json()

    assert updated["goal"] == "cut"
    assert updated["timezone"] == "Asia/Dubai"
    assert (await auth_client.get("/api/v1/me")).json()["goal"] == "cut"


async def test_an_invalid_goal_is_rejected(auth_client: AsyncClient) -> None:
    assert (await auth_client.patch("/api/v1/me", json={"goal": "shred"})).status_code == 422


async def test_no_sample_data_marker_survives_anywhere(auth_client: AsyncClient) -> None:
    """Both endpoints are computed from food_logs now.

    They used to serve one seeded snapshot to every account, marked with a
    `_source` field that the client turned into a "sample data" badge. The
    marker and the badge are gone rather than left behind as a field that is
    permanently null.
    """
    dashboard = (await auth_client.get("/api/v1/dashboard")).json()
    streaks = (await auth_client.get("/api/v1/streaks")).json()

    assert "_source" not in dashboard
    assert "_source" not in streaks


async def test_generating_a_plan_stores_it(auth_client: AsyncClient) -> None:
    response = await auth_client.post("/api/v1/plans", json={"goal": "cut"})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["goal"] == "cut"
    plan = body["generated_plan"]
    assert plan["summary"]
    assert plan["days"]
    assert plan["nudges"]

    listed = (await auth_client.get("/api/v1/plans")).json()
    assert len(listed) == 1
    assert listed[0]["id"] == body["id"]


async def test_a_plan_without_a_goal_falls_back_to_the_users_goal(
    auth_client: AsyncClient,
) -> None:
    await auth_client.patch("/api/v1/me", json={"goal": "bulk"})

    body = (await auth_client.post("/api/v1/plans", json={})).json()

    assert body["goal"] == "bulk"


async def test_the_plan_goal_is_a_snapshot_not_a_live_pointer(auth_client: AsyncClient) -> None:
    """Changing the profile goal later must not rewrite plan history."""
    await auth_client.patch("/api/v1/me", json={"goal": "cut"})
    plan = (await auth_client.post("/api/v1/plans", json={})).json()
    assert plan["goal"] == "cut"

    await auth_client.patch("/api/v1/me", json={"goal": "bulk"})

    listed = (await auth_client.get("/api/v1/plans")).json()
    assert listed[0]["goal"] == "cut"


async def test_a_plan_reflects_the_users_actual_logs(auth_client: AsyncClient) -> None:
    for _ in range(4):
        await _log_pizza(auth_client)

    plan = (await auth_client.post("/api/v1/plans", json={})).json()

    nudges = " ".join(plan["generated_plan"]["nudges"]).lower()
    assert "pizza" in nudges


async def test_plans_are_private_to_their_owner(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register", json={"email": "p1@forkast.app", "password": "password123"}
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register", json={"email": "p2@forkast.app", "password": "password123"}
        )
    ).json()

    await client.post(
        "/api/v1/plans",
        headers={"Authorization": f"Bearer {first['access_token']}"},
        json={"goal": "cut"},
    )

    theirs = await client.get(
        "/api/v1/plans", headers={"Authorization": f"Bearer {second['access_token']}"}
    )
    assert theirs.json() == []


@pytest.mark.parametrize("timezone", ["Not/A_Real_Zone", "", "   ", "Mars/Olympus"])
async def test_an_unusable_timezone_is_rejected(auth_client: AsyncClient, timezone: str) -> None:
    """Streaks bucket logs into days using this value, so a bad string here
    would fail later inside a feature that looks unrelated."""
    assert (await auth_client.patch("/api/v1/me", json={"timezone": timezone})).status_code == 422


@pytest.mark.parametrize("timezone", ["Asia/Karachi", "Asia/Dubai", "UTC", "Europe/London"])
async def test_a_real_timezone_is_accepted(auth_client: AsyncClient, timezone: str) -> None:
    response = await auth_client.patch("/api/v1/me", json={"timezone": timezone})
    assert response.status_code == 200
    assert response.json()["timezone"] == timezone


async def test_a_single_plan_can_be_read_back(auth_client: AsyncClient) -> None:
    created = (await auth_client.post("/api/v1/plans", json={"goal": "cut"})).json()

    fetched = await auth_client.get(f"/api/v1/plans/{created['id']}")

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["id"] == created["id"]


async def test_a_plan_can_be_deleted(auth_client: AsyncClient) -> None:
    created = (await auth_client.post("/api/v1/plans", json={"goal": "cut"})).json()

    assert (await auth_client.delete(f"/api/v1/plans/{created['id']}")).status_code == 204

    assert (await auth_client.get(f"/api/v1/plans/{created['id']}")).status_code == 404
    assert (await auth_client.get("/api/v1/plans")).json() == []


async def test_someone_elses_plan_is_a_404_not_a_403(client: AsyncClient) -> None:
    """No reason to confirm that an id exists."""
    owner = (
        await client.post(
            "/api/v1/auth/register", json={"email": "owner@forkast.app", "password": "password123"}
        )
    ).json()
    stranger = (
        await client.post(
            "/api/v1/auth/register",
            json={"email": "stranger@forkast.app", "password": "password123"},
        )
    ).json()

    plan = (
        await client.post(
            "/api/v1/plans",
            headers={"Authorization": f"Bearer {owner['access_token']}"},
            json={"goal": "cut"},
        )
    ).json()

    headers = {"Authorization": f"Bearer {stranger['access_token']}"}
    assert (await client.get(f"/api/v1/plans/{plan['id']}", headers=headers)).status_code == 404
    assert (await client.delete(f"/api/v1/plans/{plan['id']}", headers=headers)).status_code == 404

    # And it is still there for its owner.
    assert (
        await client.get(
            f"/api/v1/plans/{plan['id']}",
            headers={"Authorization": f"Bearer {owner['access_token']}"},
        )
    ).status_code == 200


async def test_generating_too_many_plans_is_refused(auth_client: AsyncClient) -> None:
    """The only route that costs real money once Groq is behind it, and the
    only one where an authenticated user can run up the bill."""
    limit = get_settings().plan_rate_limit
    statuses = [
        (await auth_client.post("/api/v1/plans", json={"goal": "cut"})).status_code
        for _ in range(limit + 2)
    ]

    assert 429 in statuses, f"plan generation was never throttled: {statuses}"
