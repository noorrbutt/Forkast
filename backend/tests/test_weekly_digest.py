"""The last 7 local days, summarised for the weekly reminder.

Worth testing separately from the dashboard and the trend: the window is 7
days rather than 14 or a calendar month, and the headline sentence counts
meals across the whole window rather than per day, which the other two
aggregates never do.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from httpx import AsyncClient

DIGEST = "/api/v1/insights/weekly-digest"
LOGS = "/api/v1/logs"
KARACHI = ZoneInfo("Asia/Karachi")


async def _categories(client: AsyncClient) -> dict[str, dict]:
    return {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}


async def _log(
    client: AsyncClient,
    category: dict,
    *,
    dish: str = "test dish",
    when: dt.datetime | None = None,
) -> dict:
    payload: dict = {
        "dish_name": dish,
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
    }
    if when is not None:
        payload["created_at"] = when.isoformat()

    response = await client.post(LOGS, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _set_timezone(client: AsyncClient, timezone: str) -> None:
    response = await client.patch("/api/v1/me", json={"timezone": timezone})
    assert response.status_code == 200, response.text


async def test_a_new_account_has_nothing_logged_this_week(auth_client: AsyncClient) -> None:
    body = (await auth_client.get(DIGEST)).json()

    assert body["meals_logged"] == 0
    assert body["junk_free_meals"] == 0
    assert body["days_logged"] == 0
    assert body["junk_free_days"] == 7
    assert "no meals logged" in body["message"].lower()


async def test_the_headline_counts_junk_free_meals_against_the_total(
    auth_client: AsyncClient,
) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    await _log(auth_client, categories["biryani"], dish="clean one")
    await _log(auth_client, categories["biryani"], dish="clean two")
    await _log(auth_client, categories["fries"], dish="regrettable")

    body = (await auth_client.get(DIGEST)).json()

    assert body["meals_logged"] == 3
    assert body["junk_free_meals"] == 2
    assert "2 of 3" in body["message"]


async def test_a_meal_more_than_a_week_ago_does_not_count(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    long_ago = dt.datetime.now(KARACHI) - dt.timedelta(days=10)

    await _log(auth_client, categories["biryani"], dish="ancient history", when=long_ago)

    body = (await auth_client.get(DIGEST)).json()

    assert body["meals_logged"] == 0


async def test_a_junk_day_does_not_count_toward_junk_free_days(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    await _log(auth_client, categories["fries"], dish="regrettable")

    body = (await auth_client.get(DIGEST)).json()

    assert body["days_logged"] == 1
    # Six of the seven days in the window are clean; only today has a junk log.
    assert body["junk_free_days"] == 6


async def test_an_all_clean_week_gets_its_own_message(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    await _log(auth_client, categories["biryani"], dish="clean")

    body = (await auth_client.get(DIGEST)).json()

    assert body["junk_free_meals"] == body["meals_logged"]
    assert "junk-free this week" in body["message"]


async def test_the_weekly_digest_needs_a_token(client: AsyncClient) -> None:
    assert (await client.get(DIGEST)).status_code == 401


async def test_one_users_logs_do_not_affect_another_digest(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "d1@forkast.app",
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
                "email": "d2@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    mine = {"Authorization": f"Bearer {first['access_token']}"}
    theirs = {"Authorization": f"Bearer {second['access_token']}"}

    categories = {
        c["slug"]: c for c in (await client.get("/api/v1/categories", headers=mine)).json()
    }
    await client.post(
        LOGS,
        headers=mine,
        json={
            "dish_name": "mine",
            "category_id": categories["biryani"]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )

    ours = (await client.get(DIGEST, headers=mine)).json()
    assert ours["meals_logged"] == 1

    stranger = (await client.get(DIGEST, headers=theirs)).json()
    assert stranger["meals_logged"] == 0
