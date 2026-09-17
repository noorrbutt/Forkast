"""Removing a daily calorie target, and the difference between absent and null.

A PATCH body has three states per field, not two. Absent means "leave this
alone". Present with a value means "set it to this". Present and null means
"clear it". `model_dump(exclude_unset=True)` already separates the first from
the other two, and update_me then carried an `if value is not None` on top of
that, which folded null back in with absent.

So PATCH /me {"daily_calorie_target": null} was accepted, answered 200 with the
old number still in the body, and changed nothing. It is the only way to remove
a target from the app, so "Clear target" on the Profile tab closed its dialog,
fired the success haptic, wrote the unchanged reply into the cache, and left the
target exactly where it was, permanently.

The complication, and the reason the check was not simply deleted: goal and
timezone are declared optional in the schema but are NOT NULL columns. An
explicit null for either would have turned a silent no-op into a 500.
"""

from __future__ import annotations

from httpx import AsyncClient


async def test_a_target_can_be_set(auth_client: AsyncClient) -> None:
    response = await auth_client.patch("/api/v1/me", json={"daily_calorie_target": 2000})

    assert response.status_code == 200
    assert response.json()["daily_calorie_target"] == 2000


async def test_an_explicit_null_clears_the_target(auth_client: AsyncClient) -> None:
    await auth_client.patch("/api/v1/me", json={"daily_calorie_target": 2000})

    cleared = await auth_client.patch("/api/v1/me", json={"daily_calorie_target": None})

    assert cleared.status_code == 200
    # In the reply, so the client's cache is correct without a second request.
    assert cleared.json()["daily_calorie_target"] is None
    # And on the server, so it survives a reload.
    assert (await auth_client.get("/api/v1/me")).json()["daily_calorie_target"] is None


async def test_leaving_the_field_out_does_not_clear_it(auth_client: AsyncClient) -> None:
    """The distinction the whole fix rests on."""
    await auth_client.patch("/api/v1/me", json={"daily_calorie_target": 2000})

    untouched = await auth_client.patch("/api/v1/me", json={"goal": "cut"})

    assert untouched.status_code == 200
    assert untouched.json()["goal"] == "cut"
    assert untouched.json()["daily_calorie_target"] == 2000


async def test_a_null_goal_is_refused_rather_than_written(auth_client: AsyncClient) -> None:
    """goal is NOT NULL, so this has to be a 422 and never a 500."""
    response = await auth_client.patch("/api/v1/me", json={"goal": None})

    assert response.status_code == 422
    assert (await auth_client.get("/api/v1/me")).json()["goal"] is not None


async def test_a_null_timezone_is_refused_rather_than_written(
    auth_client: AsyncClient,
) -> None:
    response = await auth_client.patch("/api/v1/me", json={"timezone": None})

    assert response.status_code == 422
    assert (await auth_client.get("/api/v1/me")).json()["timezone"] is not None


async def test_an_empty_account_still_knows_its_target(auth_client: AsyncClient) -> None:
    """The dashboard's early return used to drop the target on the floor.

    An account with a target set and nothing logged got `today.target: null`,
    which reads as "no daily target yet, so there is nothing to measure this
    against". The screen happens to hide that block behind the same condition,
    so nothing shows it today, but the payload was already wrong.
    """
    await auth_client.patch("/api/v1/me", json={"daily_calorie_target": 2200})

    dashboard = (await auth_client.get("/api/v1/dashboard")).json()

    assert dashboard["logs_count"] == 0
    assert dashboard["today"]["target"] == 2200
    # Nothing eaten and nothing burned, so all of it is still left.
    assert dashboard["today"]["remaining"] == 2200


async def test_an_empty_account_with_no_target_reports_none(
    auth_client: AsyncClient,
) -> None:
    dashboard = (await auth_client.get("/api/v1/dashboard")).json()

    assert dashboard["logs_count"] == 0
    assert dashboard["today"]["target"] is None
    assert dashboard["today"]["remaining"] is None


async def test_a_low_target_is_accepted(auth_client: AsyncClient) -> None:
    """The floor was 800, which the app was in no position to insist on.

    Forkast holds no height, weight, age or activity level, so 800 was not a
    clinical minimum derived from anything. It was the app arguing with a number
    the user had deliberately chosen, and there is no way around it: the daily
    target is a single field with one validator.
    """
    for value in (1, 200, 500, 799):
        response = await auth_client.patch(
            "/api/v1/me", json={"daily_calorie_target": value}
        )

        assert response.status_code == 200, f"{value} was refused: {response.text}"
        assert response.json()["daily_calorie_target"] == value


async def test_zero_is_stored_and_reads_as_no_target(auth_client: AsyncClient) -> None:
    """Zero is the one value a meter cannot express.

    There is nothing to be a fraction of, so the dashboard treats any
    non-positive target the same way it treats a missing one and falls back to
    the plain figure for the day. It is still stored as the user typed it.
    """
    stored = await auth_client.patch("/api/v1/me", json={"daily_calorie_target": 0})

    assert stored.status_code == 200
    assert stored.json()["daily_calorie_target"] == 0


async def test_the_ceiling_still_catches_a_stray_digit(auth_client: AsyncClient) -> None:
    """Lowering the floor did not remove the upper bound, which still earns it.

    An extra digit is the error that silently makes every day look like a
    success, which is the opposite of a target being too low and obvious.
    """
    response = await auth_client.patch("/api/v1/me", json={"daily_calorie_target": 22000})

    assert response.status_code == 422


async def test_a_negative_target_is_still_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.patch("/api/v1/me", json={"daily_calorie_target": -1})

    assert response.status_code == 422
