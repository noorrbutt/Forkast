"""Real dashboard aggregation and streak computation.

The interesting cases here are the timezone ones. Bucketing by UTC instead of
the user's own zone produces numbers that look plausible and are wrong, which is
the failure mode worth spending tests on.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

DASHBOARD = "/api/v1/dashboard"
STREAKS = "/api/v1/streaks"
LOGS = "/api/v1/logs"


async def _categories(client: AsyncClient) -> dict[str, dict]:
    return {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}


async def _log(
    client: AsyncClient,
    category: dict,
    *,
    dish: str = "test dish",
    when: dt.datetime | None = None,
    serving: str = "medium",
    fun: int | None = None,
    restaurant: str | None = None,
) -> dict:
    payload: dict = {
        "dish_name": dish,
        "category_id": category["id"],
        "rating": 4,
        "serving_size": serving,
    }
    if when is not None:
        payload["created_at"] = when.isoformat()
    if fun is not None:
        payload["fun_scale"] = fun
    if restaurant is not None:
        payload["restaurant_name"] = restaurant

    response = await client.post(LOGS, json=payload)
    assert response.status_code == 201, response.text
    # Read back rather than returned from the 201 body. Saving a meal no longer
    # waits on the calorie model: the row is written with the category midpoint
    # scaled by serving size, the response goes out, and the refinement lands
    # behind it. Anything comparing a stored total against a per meal figure has
    # to use the settled one or it is comparing two different numbers.
    settled = await client.get(f"{LOGS}/{response.json()['id']}")
    assert settled.status_code == 200, settled.text
    return settled.json()


async def _set_timezone(client: AsyncClient, timezone: str) -> None:
    response = await client.patch("/api/v1/me", json={"timezone": timezone})
    assert response.status_code == 200, response.text


async def test_junk_ratio_counts_junk_categories(auth_client: AsyncClient) -> None:
    categories = await _categories(auth_client)
    # biryani is a meal, fries are junk, per the seed data's judgement calls.
    await _log(auth_client, categories["biryani"])
    await _log(auth_client, categories["biryani"])
    await _log(auth_client, categories["biryani"])
    await _log(auth_client, categories["fries"])

    body = (await auth_client.get(DASHBOARD)).json()

    assert body["logs_count"] == 4
    assert body["junk_ratio"] == pytest.approx(0.25)


async def test_total_calories_is_the_sum_of_the_logs(auth_client: AsyncClient) -> None:
    categories = await _categories(auth_client)
    created = [
        await _log(auth_client, categories["biryani"], dish="one"),
        await _log(auth_client, categories["pizza"], dish="two"),
        await _log(auth_client, categories["salad"], dish="three"),
    ]

    body = (await auth_client.get(DASHBOARD)).json()

    assert body["total_calories"] == sum(log["estimated_calories"] for log in created)


async def test_top_category_and_restaurant_are_the_most_frequent(
    auth_client: AsyncClient,
) -> None:
    categories = await _categories(auth_client)
    for _ in range(3):
        await _log(auth_client, categories["karahi"], dish="karahi", restaurant="Kolachi")
    await _log(auth_client, categories["pizza"], dish="pizza", restaurant="Somewhere Else")

    body = (await auth_client.get(DASHBOARD)).json()

    assert body["top_category"]["name"] == "Karahi"
    assert body["top_category"]["count"] == 3
    assert body["top_restaurant"]["name"] == "Kolachi"
    assert body["top_restaurant"]["count"] == 3


async def test_the_calorie_chart_includes_days_with_nothing_logged(
    auth_client: AsyncClient,
) -> None:
    """A gap rendered as a missing bar reads as a broken app. A zero reads as a
    day that was not logged."""
    categories = await _categories(auth_client)
    await _log(auth_client, categories["biryani"])

    body = (await auth_client.get(DASHBOARD)).json()
    chart = body["calories_by_day"]

    assert len(chart) == 14
    assert [d["day"] for d in chart] == sorted(d["day"] for d in chart)
    assert sum(1 for d in chart if d["calories"] == 0) >= 12


async def test_best_fun_meals_are_ranked_and_capped(auth_client: AsyncClient) -> None:
    categories = await _categories(auth_client)
    await _log(auth_client, categories["biryani"], dish="dull", fun=2)
    await _log(auth_client, categories["biryani"], dish="great", fun=5)
    await _log(auth_client, categories["biryani"], dish="fine", fun=3)
    await _log(auth_client, categories["biryani"], dish="no rating")

    meals = (await auth_client.get(DASHBOARD)).json()["best_fun_meals"]

    assert [m["dish_name"] for m in meals] == ["great", "fine", "dull"]
    assert all(m["fun_scale"] is not None for m in meals)


async def test_one_users_logs_do_not_affect_another_dashboard(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register", json={"email": "d1@forkast.app", "password": "password123"}
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register", json={"email": "d2@forkast.app", "password": "password123"}
        )
    ).json()
    mine = {"Authorization": f"Bearer {first['access_token']}"}
    theirs = {"Authorization": f"Bearer {second['access_token']}"}

    categories = {
        c["slug"]: c for c in (await client.get("/api/v1/categories", headers=mine)).json()
    }
    for _ in range(3):
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

    assert (await client.get(DASHBOARD, headers=mine)).json()["logs_count"] == 3
    assert (await client.get(DASHBOARD, headers=theirs)).json()["logs_count"] == 0


# --- the timezone cases, which is why users.timezone exists at all ---


async def test_a_late_night_meal_counts_for_the_local_day_not_the_utc_one(
    auth_client: AsyncClient,
) -> None:
    """2am in Karachi is still the previous evening in UTC.

    Karachi is UTC+5, so a log at 02:00 local is 21:00 the previous day in UTC,
    and bucketing by UTC would file it under the wrong day. This is the exact
    case the plan called out.
    """
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    karachi = ZoneInfo("Asia/Karachi")
    now = dt.datetime.now(karachi)
    # The hour is computed rather than written as a literal, because the API
    # rejects a created_at in the future: run the suite at 00:30 local and
    # today's 02:00 has not happened yet. Take the most recent 02:00 that has,
    # which is today's once 02:00 is past and yesterday's before then.
    late_night = dt.datetime.combine(now.date(), dt.time(2, 0), tzinfo=karachi)
    if late_night > now:
        late_night -= dt.timedelta(days=1)
    local_day = late_night.date()

    # The premise, stated rather than assumed: the instant only proves anything
    # if its UTC date really is the day before its local one.
    assert late_night.astimezone(dt.UTC).date() == local_day - dt.timedelta(days=1)

    await _log(auth_client, categories["biryani"], dish="late biryani", when=late_night)

    chart = {
        d["day"]: d["calories"]
        for d in (await auth_client.get(DASHBOARD)).json()["calories_by_day"]
    }

    assert chart[local_day.isoformat()] > 0, "the 2am meal was filed under the wrong day"
    utc_day = (local_day - dt.timedelta(days=1)).isoformat()
    assert chart.get(utc_day, 0) == 0


async def test_changing_timezone_moves_which_day_a_log_belongs_to(
    auth_client: AsyncClient,
) -> None:
    """The same instant is a different calendar day in a different zone, and the
    dashboard has to follow the user rather than the server."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    karachi = ZoneInfo("Asia/Karachi")
    honolulu = ZoneInfo("Pacific/Honolulu")
    now = dt.datetime.now(karachi)
    # Computed rather than a literal hour, because a created_at in the future is
    # a 422 and today's 03:00 does not exist yet between midnight and 3am. Any
    # Karachi wall time before 15:00 is still the previous day in Honolulu, so
    # the most recent 03:00 straddles the boundary whatever time the suite runs.
    instant = dt.datetime.combine(now.date(), dt.time(3, 0), tzinfo=karachi)
    if instant > now:
        instant -= dt.timedelta(days=1)

    # The premise, stated rather than assumed: with an instant the two zones
    # agree on, the comparison at the end of the test would hold for free.
    assert instant.astimezone(honolulu).date() == instant.date() - dt.timedelta(days=1)

    await _log(auth_client, categories["biryani"], dish="boundary meal", when=instant)

    in_karachi = {
        d["day"]: d["calories"]
        for d in (await auth_client.get(DASHBOARD)).json()["calories_by_day"]
    }

    # Honolulu is UTC-10, so that instant is the previous afternoon there.
    await _set_timezone(auth_client, "Pacific/Honolulu")
    in_honolulu = {
        d["day"]: d["calories"]
        for d in (await auth_client.get(DASHBOARD)).json()["calories_by_day"]
    }

    karachi_day = max(day for day, cals in in_karachi.items() if cals > 0)
    honolulu_day = max(day for day, cals in in_honolulu.items() if cals > 0)
    assert honolulu_day < karachi_day, "the bucket did not follow the user's timezone"


async def test_a_junk_log_today_breaks_the_streak(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    # An account with no logs at all has no streak to speak of, so start one.
    await _log(auth_client, categories["biryani"], dish="clean meal")
    clean = (await auth_client.get(STREAKS)).json()
    assert clean["current_streak"] > 0, "logging only non junk food is a streak"

    await _log(auth_client, categories["fries"], dish="fries today")

    broken = (await auth_client.get(STREAKS)).json()
    assert broken["current_streak"] == 0
    assert "no drama" in broken["message"].lower()


async def test_a_non_junk_log_does_not_break_the_streak(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    await _log(auth_client, categories["biryani"], dish="first clean meal")
    before = (await auth_client.get(STREAKS)).json()["current_streak"]
    # Exactly one, not merely non-zero. The walk back has to stop at the first
    # day the account ever logged; running it to the window edge instead handed
    # a user who logged one clean meal this morning a streak of a full year.
    assert before == 1

    await _log(auth_client, categories["biryani"], dish="second clean meal")
    after = (await auth_client.get(STREAKS)).json()["current_streak"]

    assert after == before


async def test_the_longest_streak_survives_a_later_break(auth_client: AsyncClient) -> None:
    """A long clean run in the past must still be reported after it ends."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    karachi = ZoneInfo("Asia/Karachi")
    now = dt.datetime.now(karachi)
    today = now.date()

    def at(days_ago: int) -> dt.datetime:
        """Anchored to the current local time, never to a literal hour.

        The junk log has to land on today to reset the current streak, and the
        API rejects a created_at in the future, so a fixed 13:00 fails every
        morning. Stepping whole days back from now is in the past at any hour
        and still puts each log on its own local day.
        """
        return now - dt.timedelta(days=days_ago)

    # Junk 20 days ago and again today, leaving a clean run in between.
    await _log(auth_client, categories["fries"], dish="old fries", when=at(20))
    await _log(auth_client, categories["biryani"], dish="clean run", when=at(10))
    await _log(auth_client, categories["fries"], dish="fries today", when=at(0))

    body = (await auth_client.get(STREAKS)).json()

    assert body["current_streak"] == 0
    assert body["longest_streak"] == 19, "the clean days between the two junk days"
    assert body["last_junk_date"] == today.isoformat()
    # Which meal ended it, not only when. The date alone leaves the reader to
    # remember, and it is the only part of that row they can act on. It must be
    # today's junk rather than the one twenty days ago that also broke a run.
    assert body["last_junk_dish"] == "fries today"


async def test_a_clean_account_names_no_dish_as_the_slip(auth_client: AsyncClient) -> None:
    """No junk means no date and no dish, rather than a dish with no date."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    await _log(auth_client, categories["biryani"], dish="only clean food")

    body = (await auth_client.get(STREAKS)).json()

    assert body["last_junk_date"] is None
    assert body["last_junk_dish"] is None


async def test_tea_does_not_break_a_streak(auth_client: AsyncClient) -> None:
    """The drink split is the point of having two drink categories.

    There was one Beverage category at 170 to 300 and it was junk, so a cup of
    tea could only be logged as junk, and junk ends a run. Sweet drinks are
    still junk; tea and coffee are not.
    """
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    await _log(auth_client, categories["tea_coffee"], dish="doodh patti chai")
    body = (await auth_client.get(STREAKS)).json()
    assert body["current_streak"] >= 1, "tea is not junk"
    assert body["last_junk_date"] is None

    await _log(auth_client, categories["beverage"], dish="creamy oreo shake")
    body = (await auth_client.get(STREAKS)).json()
    assert body["current_streak"] == 0, "a sweet drink still is junk"
    assert body["last_junk_dish"] == "creamy oreo shake"


async def test_deleting_a_junk_log_restores_the_streak(auth_client: AsyncClient) -> None:
    """Streaks are recomputed rather than stored, so an edit has to be reflected
    immediately. A stored counter would drift here."""
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)

    # A non junk log so the account still has history after the deletion.
    await _log(auth_client, categories["biryani"], dish="the good one")
    junk = await _log(auth_client, categories["fries"], dish="regrettable fries")
    assert (await auth_client.get(STREAKS)).json()["current_streak"] == 0

    assert (await auth_client.delete(f"{LOGS}/{junk['id']}")).status_code == 204

    assert (await auth_client.get(STREAKS)).json()["current_streak"] > 0
