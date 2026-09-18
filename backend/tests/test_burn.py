"""Calories burned, and the net figure that depends on them."""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

BURN = "/api/v1/burn"
DASHBOARD = "/api/v1/dashboard"
LOGS = "/api/v1/logs"


async def _set_timezone(client: AsyncClient, timezone: str) -> None:
    assert (await client.patch("/api/v1/me", json={"timezone": timezone})).status_code == 200


async def _eat(client: AsyncClient, slug: str = "biryani") -> int:
    categories = {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}
    response = await client.post(
        LOGS,
        json={
            "dish_name": "test meal",
            "category_id": categories[slug]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 201, response.text
    # Read back rather than returned from the 201 body. Saving a meal no longer
    # waits on the calorie model: the row is written with the category midpoint
    # scaled by serving size, the response goes out, and the refinement lands
    # behind it. Anything comparing a stored total against a per meal figure has
    # to use the settled one or it is comparing two different numbers.
    settled = await client.get(f"{LOGS}/{response.json()['id']}")
    assert settled.status_code == 200, settled.text
    return settled.json()["estimated_calories"]


async def test_setting_a_burn_stores_it(auth_client: AsyncClient) -> None:
    response = await auth_client.put(BURN, json={"calories": 420})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["calories"] == 420
    assert body["day"] == dt.datetime.now(ZoneInfo("Asia/Karachi")).date().isoformat()


async def test_setting_it_twice_overwrites_rather_than_stacking(auth_client: AsyncClient) -> None:
    """One number per day is the whole model, so a second save is a correction."""
    first = (await auth_client.put(BURN, json={"calories": 300})).json()
    second = (await auth_client.put(BURN, json={"calories": 500})).json()

    assert second["calories"] == 500
    assert second["id"] == first["id"], "a second save created a second row"
    assert len((await auth_client.get(BURN)).json()) == 1


async def test_the_dashboard_subtracts_it(auth_client: AsyncClient) -> None:
    eaten = await _eat(auth_client)
    await auth_client.put(BURN, json={"calories": 200})

    body = (await auth_client.get(DASHBOARD)).json()

    assert body["total_calories"] == eaten
    assert body["total_burned"] == 200
    assert body["net_calories"] == eaten - 200


async def test_net_is_allowed_to_go_negative(auth_client: AsyncClient) -> None:
    """Burning more than you ate is a real day, not an error to clamp away."""
    eaten = await _eat(auth_client, "salad")
    await auth_client.put(BURN, json={"calories": eaten + 500})

    body = (await auth_client.get(DASHBOARD)).json()

    assert body["net_calories"] < 0


async def test_a_day_with_no_entry_reads_as_zero_not_missing(auth_client: AsyncClient) -> None:
    await _eat(auth_client)

    chart = (await auth_client.get(DASHBOARD)).json()["calories_by_day"]

    assert len(chart) == 14
    assert all("burned" in day for day in chart)
    assert all(day["burned"] == 0 for day in chart)


async def test_the_burn_appears_against_the_right_day_in_the_chart(
    auth_client: AsyncClient,
) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    today = dt.datetime.now(ZoneInfo("Asia/Karachi")).date()
    await auth_client.put(BURN, json={"calories": 350})
    await _eat(auth_client)

    chart = {d["day"]: d for d in (await auth_client.get(DASHBOARD)).json()["calories_by_day"]}

    assert chart[today.isoformat()]["burned"] == 350


async def test_a_past_day_can_be_filled_in(auth_client: AsyncClient) -> None:
    """The same allowance a forgotten meal gets."""
    yesterday = (
        dt.datetime.now(ZoneInfo("Asia/Karachi")).date() - dt.timedelta(days=1)
    ).isoformat()

    response = await auth_client.put(BURN, json={"calories": 250, "day": yesterday})

    assert response.status_code == 200
    assert response.json()["day"] == yesterday


async def test_today_reflects_the_users_timezone_not_the_servers(
    auth_client: AsyncClient,
) -> None:
    """The same reason the streak buckets by the user's day: an evening entry in
    Karachi must not be filed under the server's yesterday."""
    await _set_timezone(auth_client, "Pacific/Honolulu")

    body = (await auth_client.put(BURN, json={"calories": 100})).json()

    assert body["day"] == dt.datetime.now(ZoneInfo("Pacific/Honolulu")).date().isoformat()


@pytest.mark.parametrize("calories", [-1, 10_001, 999_999])
async def test_an_implausible_number_is_rejected(auth_client: AsyncClient, calories: int) -> None:
    """A stray zero would swamp the net figure and the chart scale."""
    assert (await auth_client.put(BURN, json={"calories": calories})).status_code == 422


async def test_zero_is_accepted_because_it_is_a_real_answer(auth_client: AsyncClient) -> None:
    response = await auth_client.put(BURN, json={"calories": 0})

    assert response.status_code == 200
    assert response.json()["calories"] == 0


async def test_today_is_null_before_anything_is_entered(auth_client: AsyncClient) -> None:
    """Distinct from a deliberate zero, so the client can prompt rather than
    show a figure the user never gave."""
    assert (await auth_client.get(f"{BURN}/today")).json() is None

    await auth_client.put(BURN, json={"calories": 175})

    assert (await auth_client.get(f"{BURN}/today")).json()["calories"] == 175


async def test_an_entry_can_be_taken_back(auth_client: AsyncClient) -> None:
    await auth_client.put(BURN, json={"calories": 400})
    today = dt.datetime.now(ZoneInfo("Asia/Karachi")).date().isoformat()

    assert (await auth_client.delete(f"{BURN}/{today}")).status_code == 204

    assert (await auth_client.get(f"{BURN}/today")).json() is None
    assert (await auth_client.get(DASHBOARD)).json()["total_burned"] == 0


async def test_deleting_a_day_that_was_never_entered_is_not_an_error(
    auth_client: AsyncClient,
) -> None:
    assert (await auth_client.delete(f"{BURN}/2020-01-01")).status_code == 204


async def test_one_users_burn_does_not_reach_another_dashboard(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "b1@forkast.app",
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
                "email": "b2@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    mine = {"Authorization": f"Bearer {first['access_token']}"}
    theirs = {"Authorization": f"Bearer {second['access_token']}"}

    await client.put(BURN, headers=mine, json={"calories": 600})

    assert (await client.get(DASHBOARD, headers=mine)).json()["total_burned"] == 600
    assert (await client.get(DASHBOARD, headers=theirs)).json()["total_burned"] == 0


async def test_burn_routes_need_authentication(client: AsyncClient) -> None:
    assert (await client.get(BURN)).status_code == 401
    assert (await client.put(BURN, json={"calories": 100})).status_code == 401
    assert (await client.get(f"{BURN}/today")).status_code == 401


async def test_a_burn_shows_up_even_with_no_meals_logged(auth_client: AsyncClient) -> None:
    """Regression: the dashboard used to return its empty shape as soon as there
    were no food logs, before it had looked at burn at all. Recording a walk on
    a day you have not logged any food is ordinary, and reporting zero for it
    hid the only thing the user had entered.
    """
    await auth_client.put(BURN, json={"calories": 450})

    body = (await auth_client.get(DASHBOARD)).json()

    assert body["logs_count"] == 0
    assert body["total_calories"] == 0
    assert body["total_burned"] == 450
    assert body["net_calories"] == -450
    assert body["junk_ratio"] == 0
    # The chart still has to be drawable, with the burn against the right day.
    assert len(body["calories_by_day"]) == 14
    assert sum(day["burned"] for day in body["calories_by_day"]) == 450
