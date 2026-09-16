"""This calendar month against last, in the user's own timezone.

Two things are worth spending tests on. The month boundary is a local one, so a
meal in the first minutes of a month must not be dragged into the previous one
by its UTC date, which is the same failure the dashboard's day bucketing has.
And a month with nothing in it has to answer with zeroes: nulls here would put a
null check on every metric in the client, and a 404 would make an empty month
look like a broken screen.
"""

from __future__ import annotations

import calendar
import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

TREND = "/api/v1/trend"
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


def _month_starts(today: dt.date) -> tuple[dt.date, dt.date]:
    """The first of this month and the first of last, computed independently of
    the service so a wrong answer there cannot agree with a wrong answer here."""
    this_start = today.replace(day=1)
    last_start = (this_start - dt.timedelta(days=1)).replace(day=1)
    return this_start, last_start


def _in_last_month(last_start: dt.date, *, hour: int = 13) -> dt.datetime:
    """The fifth of last month, which every month has, safely in the past."""
    return dt.datetime.combine(last_start + dt.timedelta(days=4), dt.time(hour), tzinfo=KARACHI)


async def test_a_new_account_gets_zeroes_for_both_months(auth_client: AsyncClient) -> None:
    """Zeroes, not nulls and not an error. An empty month is a real answer."""
    await _set_timezone(auth_client, "Asia/Karachi")

    response = await auth_client.get(TREND)

    assert response.status_code == 200, response.text
    body = response.json()
    for period in (body["this_month"], body["last_month"]):
        assert period["total_calories"] == 0
        assert period["meals_logged"] == 0
        assert period["junk_ratio"] == 0.0
        assert period["avg_calories_per_day"] == 0.0
        assert period["days_counted"] > 0
    assert body["change"] == {
        "total_calories": 0,
        "meals_logged": 0,
        "junk_ratio": 0.0,
        "avg_calories_per_day": 0.0,
    }


async def test_each_month_is_labelled_with_its_own_first_day(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    this_start, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    body = (await auth_client.get(TREND)).json()

    assert body["this_month"]["month"] == this_start.isoformat()
    assert body["last_month"]["month"] == last_start.isoformat()


async def test_this_month_counts_only_this_months_meals(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    _, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    now_meal = await _log(auth_client, categories["biryani"], dish="this month")
    then_meal = await _log(
        auth_client, categories["biryani"], dish="last month", when=_in_last_month(last_start)
    )

    body = (await auth_client.get(TREND)).json()

    assert body["this_month"]["meals_logged"] == 1
    assert body["this_month"]["total_calories"] == now_meal["estimated_calories"]
    assert body["last_month"]["meals_logged"] == 1
    assert body["last_month"]["total_calories"] == then_meal["estimated_calories"]


async def test_the_change_is_this_month_minus_last_month(auth_client: AsyncClient) -> None:
    """Returned rather than left to the client, so every surface draws the same
    arrow from the same subtraction."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    _, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    await _log(auth_client, categories["biryani"], dish="this month")
    for day_offset, dish in enumerate(("last one", "last two", "last three")):
        await _log(
            auth_client,
            categories["biryani"],
            dish=dish,
            when=_in_last_month(last_start) + dt.timedelta(days=day_offset),
        )

    body = (await auth_client.get(TREND)).json()
    this_month, last_month, change = body["this_month"], body["last_month"], body["change"]

    assert change["meals_logged"] == this_month["meals_logged"] - last_month["meals_logged"]
    assert change["total_calories"] == this_month["total_calories"] - last_month["total_calories"]
    assert change["junk_ratio"] == pytest.approx(
        this_month["junk_ratio"] - last_month["junk_ratio"], abs=1e-4
    )
    assert change["avg_calories_per_day"] == pytest.approx(
        this_month["avg_calories_per_day"] - last_month["avg_calories_per_day"], abs=0.1
    )
    # Eating less this month than last has to read as a negative, not as an
    # absolute difference that hides which way it went.
    assert change["meals_logged"] == -2


async def test_the_junk_ratio_is_computed_per_month(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    _, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    # Half of this month is junk; none of last month is.
    await _log(auth_client, categories["biryani"], dish="a meal")
    await _log(auth_client, categories["fries"], dish="regrettable fries")
    await _log(
        auth_client, categories["biryani"], dish="last month", when=_in_last_month(last_start)
    )

    body = (await auth_client.get(TREND)).json()

    assert body["this_month"]["junk_ratio"] == pytest.approx(0.5)
    assert body["last_month"]["junk_ratio"] == 0.0
    assert body["change"]["junk_ratio"] == pytest.approx(0.5)


async def test_this_month_is_averaged_over_the_days_so_far(auth_client: AsyncClient) -> None:
    """Dividing a three day old month by thirty would show every user a collapse
    in intake that reverses itself by the end of the month."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    today = dt.datetime.now(KARACHI).date()

    meal = await _log(auth_client, categories["biryani"], dish="today")

    this_month = (await auth_client.get(TREND)).json()["this_month"]

    assert this_month["days_counted"] == today.day
    assert this_month["avg_calories_per_day"] == pytest.approx(
        round(meal["estimated_calories"] / today.day, 1)
    )


async def test_last_month_is_averaged_over_its_full_length(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    _, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    meal = await _log(
        auth_client, categories["biryani"], dish="last month", when=_in_last_month(last_start)
    )

    last_month = (await auth_client.get(TREND)).json()["last_month"]

    days_in_last_month = calendar.monthrange(last_start.year, last_start.month)[1]
    assert last_month["days_counted"] == days_in_last_month
    assert last_month["avg_calories_per_day"] == pytest.approx(
        round(meal["estimated_calories"] / days_in_last_month, 1)
    )


async def test_the_first_minutes_of_a_month_belong_to_that_month_locally(
    auth_client: AsyncClient,
) -> None:
    """Karachi is UTC+5, so 00:30 on the first is still the previous month in
    UTC. Bucketing by UTC would drop this meal out of last month and out of the
    month before it too, since only two columns are returned."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    _, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    just_after_midnight = dt.datetime.combine(last_start, dt.time(0, 30), tzinfo=KARACHI)
    # The premise, stated rather than assumed.
    assert just_after_midnight.astimezone(dt.UTC).date() < last_start

    meal = await _log(
        auth_client, categories["biryani"], dish="new month", when=just_after_midnight
    )

    body = (await auth_client.get(TREND)).json()

    assert body["last_month"]["meals_logged"] == 1, "the meal was filed under the wrong month"
    assert body["last_month"]["total_calories"] == meal["estimated_calories"]
    assert body["this_month"]["meals_logged"] == 0


async def test_the_boundary_between_the_two_months_is_the_local_one(
    auth_client: AsyncClient,
) -> None:
    """The same instant, on the near side of the boundary this time: 00:30 on
    the first of this month is last month in UTC, and must still land here."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    now = dt.datetime.now(KARACHI)
    this_start, _ = _month_starts(now.date())

    just_after_midnight = dt.datetime.combine(this_start, dt.time(0, 30), tzinfo=KARACHI)
    if just_after_midnight > now:
        # A half hour window at the top of each month where the instant has not
        # happened yet and the API rightly refuses a created_at in the future.
        pytest.skip("it is not yet 00:30 on the first of the month in Karachi")

    await _log(auth_client, categories["biryani"], dish="new month", when=just_after_midnight)

    body = (await auth_client.get(TREND)).json()

    assert body["this_month"]["meals_logged"] == 1, "the meal fell back into last month"
    assert body["last_month"]["meals_logged"] == 0


async def test_changing_timezone_can_move_a_meal_between_the_two_months(
    auth_client: AsyncClient,
) -> None:
    """The months follow the user, not the server. Honolulu is UTC-10, so an
    instant just after midnight on the first in Karachi is still the last
    afternoon of the previous month there."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    this_start, last_start = _month_starts(dt.datetime.now(KARACHI).date())

    honolulu = ZoneInfo("Pacific/Honolulu")
    if dt.datetime.now(honolulu).date().replace(day=1) != this_start:
        # The two zones are 15 hours apart, so on the first of the month they
        # disagree about which month "this" one is and the two columns no longer
        # describe the same pair. Nothing to compare on that day.
        pytest.skip("Karachi and Honolulu are in different calendar months right now")

    just_after_midnight = dt.datetime.combine(last_start, dt.time(0, 30), tzinfo=KARACHI)
    await _log(auth_client, categories["biryani"], dish="boundary meal", when=just_after_midnight)

    assert (await auth_client.get(TREND)).json()["last_month"]["meals_logged"] == 1

    await _set_timezone(auth_client, "Pacific/Honolulu")
    in_honolulu = (await auth_client.get(TREND)).json()

    assert in_honolulu["last_month"]["meals_logged"] == 0, "the bucket ignored the new timezone"
    assert in_honolulu["this_month"]["meals_logged"] == 0


async def test_one_users_logs_do_not_affect_another_trend(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register", json={"email": "t1@forkast.app", "password": "password123"}
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register", json={"email": "t2@forkast.app", "password": "password123"}
        )
    ).json()
    mine = {"Authorization": f"Bearer {first['access_token']}"}
    theirs = {"Authorization": f"Bearer {second['access_token']}"}

    categories = {c["slug"]: c for c in (await client.get("/api/v1/categories", headers=mine)).json()}
    _, last_start = _month_starts(dt.datetime.now(KARACHI).date())
    for when in (None, _in_last_month(last_start)):
        payload: dict = {
            "dish_name": "mine",
            "category_id": categories["fries"]["id"],
            "rating": 4,
            "serving_size": "medium",
        }
        if when is not None:
            payload["created_at"] = when.isoformat()
        assert (await client.post(LOGS, headers=mine, json=payload)).status_code == 201

    ours = (await client.get(TREND, headers=mine)).json()
    assert ours["this_month"]["meals_logged"] == 1
    assert ours["last_month"]["meals_logged"] == 1

    stranger = (await client.get(TREND, headers=theirs)).json()
    assert stranger["this_month"]["meals_logged"] == 0
    assert stranger["last_month"]["meals_logged"] == 0
    assert stranger["this_month"]["total_calories"] == 0
    assert stranger["last_month"]["junk_ratio"] == 0.0


async def test_the_trend_needs_a_token(client: AsyncClient) -> None:
    assert (await client.get(TREND)).status_code == 401
