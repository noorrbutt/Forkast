"""Changing a password, and what it does to the other devices.

The interesting half is not the hashing, it is the sessions. A password change
is what someone does after losing a phone, so the devices they no longer hold
have to stop working, while the one in their hand must not be thrown out for
having asked.
"""

from __future__ import annotations

from httpx import AsyncClient

ME = "/api/v1/me"
PASSWORD = "/api/v1/me/password"
REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"

OLD = "password123"
NEW = "a-far-better-password"


async def _register(client: AsyncClient, email: str, password: str = OLD) -> dict:
    response = await client.post(
        REGISTER,
        json={"first_name": "Test", "last_name": "User", "email": email, "password": password},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _login(client: AsyncClient, email: str, password: str):
    return await client.post(LOGIN, json={"email": email, "password": password})


async def test_the_new_password_works_and_the_old_one_stops(
    auth_client: AsyncClient, fixture_email: str
) -> None:
    response = await auth_client.put(PASSWORD, json={"current_password": OLD, "new_password": NEW})

    assert response.status_code == 204, response.text
    assert (await _login(auth_client, fixture_email, OLD)).status_code == 401
    assert (await _login(auth_client, fixture_email, NEW)).status_code == 200


async def test_the_wrong_current_password_changes_nothing(
    auth_client: AsyncClient, fixture_email: str
) -> None:
    """A session proves the phone, not the person holding it."""
    response = await auth_client.put(
        PASSWORD, json={"current_password": "not-the-password", "new_password": NEW}
    )

    assert response.status_code == 403
    assert (await _login(auth_client, fixture_email, OLD)).status_code == 200
    assert (await _login(auth_client, fixture_email, NEW)).status_code == 401


async def test_a_new_password_under_eight_characters_is_refused(
    auth_client: AsyncClient, fixture_email: str
) -> None:
    """Registration will not accept one that short, so a change must not be the
    side door that lets it in."""
    response = await auth_client.put(
        PASSWORD, json={"current_password": OLD, "new_password": "sevench"}
    )

    assert response.status_code == 422
    assert (await _login(auth_client, fixture_email, OLD)).status_code == 200


async def test_changing_a_password_asks_for_both_of_them(auth_client: AsyncClient) -> None:
    assert (await auth_client.put(PASSWORD, json={"new_password": NEW})).status_code == 422
    assert (await auth_client.put(PASSWORD, json={"current_password": OLD})).status_code == 422


async def test_the_device_that_changed_it_stays_signed_in(client: AsyncClient) -> None:
    """Ending this session too would drop the caller at a login screen the moment
    they proved they knew both passwords."""
    tokens = await _register(client, "stays@forkast.app")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    assert (
        await client.put(
            PASSWORD, headers=headers, json={"current_password": OLD, "new_password": NEW}
        )
    ).status_code == 204

    assert (await client.get(ME, headers=headers)).status_code == 200
    rotated = await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})
    assert rotated.status_code == 200, "the device that asked was signed out anyway"


async def test_every_other_device_is_signed_out(client: AsyncClient) -> None:
    tokens = await _register(client, "others@forkast.app")
    second = (await _login(client, "others@forkast.app", OLD)).json()
    second_headers = {"Authorization": f"Bearer {second['access_token']}"}

    assert (await client.get(ME, headers=second_headers)).status_code == 200

    assert (
        await client.put(
            PASSWORD,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            json={"current_password": OLD, "new_password": NEW},
        )
    ).status_code == 204

    # The access token is still syntactically valid; the session behind it is
    # gone, so it stops working now rather than whenever it expires.
    assert (await client.get(ME, headers=second_headers)).status_code == 401
    assert (
        await client.post(REFRESH, json={"refresh_token": second["refresh_token"]})
    ).status_code == 401


async def test_an_evicted_device_cannot_take_the_caller_down_with_it(
    client: AsyncClient,
) -> None:
    """The reason the other sessions are deleted rather than marked revoked.

    A revoked refresh token that is presented again is what /auth/refresh reads
    as a leaked chain, and it answers by revoking every live token on the
    account. Left as revoked rows, the evicted phone's next refresh would sign
    out the person who had just changed their password.
    """
    tokens = await _register(client, "trap@forkast.app")
    evicted = (await _login(client, "trap@forkast.app", OLD)).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    assert (
        await client.put(
            PASSWORD, headers=headers, json={"current_password": OLD, "new_password": NEW}
        )
    ).status_code == 204

    assert (
        await client.post(REFRESH, json={"refresh_token": evicted["refresh_token"]})
    ).status_code == 401

    assert (await client.get(ME, headers=headers)).status_code == 200
    assert (
        await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})
    ).status_code == 200


async def test_replaying_the_callers_own_spent_token_still_kills_the_chain(
    client: AsyncClient,
) -> None:
    """Reuse detection must survive a password change for the session that is
    still in use, or changing a password would quietly disarm it."""
    tokens = await _register(client, "still-armed@forkast.app")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    assert (
        await client.put(
            PASSWORD, headers=headers, json={"current_password": OLD, "new_password": NEW}
        )
    ).status_code == 204

    rotated = (await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})).json()

    # The spent one comes back, the way a stolen copy would.
    assert (
        await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})
    ).status_code == 401
    assert (
        await client.post(REFRESH, json={"refresh_token": rotated["refresh_token"]})
    ).status_code == 401


async def test_changing_a_password_needs_authentication(client: AsyncClient) -> None:
    response = await client.put(PASSWORD, json={"current_password": OLD, "new_password": NEW})

    assert response.status_code == 401
