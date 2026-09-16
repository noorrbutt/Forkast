"""Profile, the placeholder dashboard and streak endpoints, and AI plans."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.schemas.insights import PLACEHOLDER_SOURCE


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


async def test_dashboard_is_marked_as_placeholder_data(auth_client: AsyncClient) -> None:
    """The scaffold serves a seed snapshot here rather than real aggregation.

    The marker is the contract: the client shows a "sample data" badge whenever
    it is present, so these numbers are never mistaken for real analytics.
    """
    body = (await auth_client.get("/api/v1/dashboard")).json()

    assert body["_source"] == PLACEHOLDER_SOURCE
    assert "junk_ratio" in body
    assert "burn_equivalents" in body
    assert {"walking_minutes", "running_minutes", "cycling_minutes"} <= set(
        body["burn_equivalents"]
    )


async def test_streaks_is_marked_as_placeholder_data(auth_client: AsyncClient) -> None:
    body = (await auth_client.get("/api/v1/streaks")).json()

    assert body["_source"] == PLACEHOLDER_SOURCE
    assert isinstance(body["current_streak"], int)
    assert isinstance(body["longest_streak"], int)
    assert body["message"]


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
    categories = (await auth_client.get("/api/v1/categories")).json()
    pizza = next(c for c in categories if c["slug"] == "pizza")
    for _ in range(4):
        await auth_client.post(
            "/api/v1/logs",
            json={
                "dish_name": "pepperoni pizza",
                "category_id": pizza["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )

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

