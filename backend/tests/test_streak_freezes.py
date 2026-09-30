"""Streak milestones and the freezes they earn.

The interesting behaviour here is entirely about the boundary conditions: a
streak hitting exactly a milestone length, a freeze bridging one junk day
without erasing that it happened, and a milestone never being granted twice
for the same streak length.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from httpx import AsyncClient

STREAKS = "/api/v1/streaks"
LOGS = "/api/v1/logs"
KARACHI = ZoneInfo("Asia/Karachi")


async def _categories(client: AsyncClient) -> dict[str, dict]:
    return {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}


async def _log(
    client: AsyncClient,
    category: dict,
    *,
    dish: str = "test dish",
    when: dt.datetime,
) -> dict:
    payload = {
        "dish_name": dish,
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
        "created_at": when.isoformat(),
    }
    response = await client.post(LOGS, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _set_timezone(client: AsyncClient, timezone: str) -> None:
    response = await client.patch("/api/v1/me", json={"timezone": timezone})
    assert response.status_code == 200, response.text


def _at_noon_or_now(day: dt.date) -> dt.datetime:
    """Noon Karachi on `day`, unless that is still ahead of the actual clock.

    Karachi runs five hours ahead of UTC, so "today" by the Karachi calendar
    can start before UTC has reached the corresponding noon instant. The API
    rejects a future created_at outright, so building noon blindly is flaky
    for however much of the UTC day sits before that boundary.
    """
    noon = dt.datetime.combine(day, dt.time(12), tzinfo=KARACHI)
    return min(noon, dt.datetime.now(KARACHI))


async def _log_clean_streak(
    client: AsyncClient, categories: dict, days: int, today: dt.date
) -> None:
    """Days [today - days + 1, today], each with one clean meal at noon."""
    for offset in range(days):
        day = today - dt.timedelta(days=days - 1 - offset)
        await _log(
            client,
            categories["biryani"],
            dish=f"clean day {offset}",
            when=_at_noon_or_now(day),
        )


async def test_hitting_a_milestone_reports_it_and_grants_a_freeze(
    auth_client: AsyncClient,
) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    today = dt.datetime.now(KARACHI).date()

    await _log_clean_streak(auth_client, categories, 3, today)

    body = (await auth_client.get(STREAKS)).json()

    assert body["current_streak"] == 3
    assert body["milestone"] == {"day": 3, "reward": "freeze"}
    assert body["available_freezes"] == 1


async def test_a_streak_between_milestones_reports_none(auth_client: AsyncClient) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    today = dt.datetime.now(KARACHI).date()

    await _log_clean_streak(auth_client, categories, 4, today)

    body = (await auth_client.get(STREAKS)).json()

    assert body["current_streak"] == 4
    assert body["milestone"] is None


async def test_the_milestone_is_only_granted_once_per_streak_length(
    auth_client: AsyncClient,
) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    today = dt.datetime.now(KARACHI).date()

    await _log_clean_streak(auth_client, categories, 3, today)
    first = (await auth_client.get(STREAKS)).json()
    # Asking again the same day, still sitting at day 3 -- the fact is
    # reported again (the client owns the one-time celebration), but the
    # reward itself is not handed out twice.
    second = (await auth_client.get(STREAKS)).json()

    assert first["available_freezes"] == 1
    assert second["available_freezes"] == 1
    assert second["milestone"] == {"day": 3, "reward": "freeze"}


async def test_a_banked_freeze_bridges_a_junk_day_without_breaking_the_streak(
    auth_client: AsyncClient,
) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    today = dt.datetime.now(KARACHI).date()

    # Three clean days, ending today, earns the day-3 milestone and its freeze.
    await _log_clean_streak(auth_client, categories, 3, today)
    milestone_body = (await auth_client.get(STREAKS)).json()
    assert milestone_body["current_streak"] == 3
    assert milestone_body["available_freezes"] == 1

    # A junk meal lands later the same day -- the run would otherwise reset to
    # zero right after reaching its first milestone.
    await _log(
        auth_client,
        categories["fries"],
        dish="regrettable",
        when=dt.datetime.now(KARACHI),
    )

    body = (await auth_client.get(STREAKS)).json()

    # The freeze absorbed today, so the run holds at 3 instead of resetting.
    assert body["current_streak"] == 3
    assert body["available_freezes"] == 0
    # The slip is still on record; a freeze protects the streak, it does not
    # pretend the junk log never happened.
    assert body["last_junk_date"] == today.isoformat()


async def test_without_a_freeze_a_junk_day_still_resets_the_streak(
    auth_client: AsyncClient,
) -> None:
    await _set_timezone(auth_client, "Asia/Karachi")
    categories = await _categories(auth_client)
    today = dt.datetime.now(KARACHI).date()

    junk_day = today - dt.timedelta(days=1)
    await _log(
        auth_client,
        categories["fries"],
        dish="regrettable",
        when=_at_noon_or_now(junk_day),
    )
    await _log_clean_streak(auth_client, categories, 1, today)

    body = (await auth_client.get(STREAKS)).json()

    assert body["current_streak"] == 1
    assert body["available_freezes"] == 0
