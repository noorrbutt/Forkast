"""Auth: registration, login, refresh rotation, logout and route protection."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken, User
from app.services.security import decode_access_token, hash_refresh_token

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"


async def test_register_returns_a_usable_token_pair(client: AsyncClient) -> None:
    response = await client.post(
        REGISTER, json={"email": "new@forkast.app", "password": "password123"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]
    # The access token must actually decode back to a user.
    assert decode_access_token(body["access_token"]) is not None


async def test_register_rejects_a_duplicate_email_case_insensitively(
    client: AsyncClient,
) -> None:
    await client.post(REGISTER, json={"email": "dupe@forkast.app", "password": "password123"})
    response = await client.post(
        REGISTER, json={"email": "DUPE@forkast.app", "password": "password123"}
    )

    assert response.status_code == 409


async def test_password_is_hashed_not_stored(client: AsyncClient, session: AsyncSession) -> None:
    await client.post(REGISTER, json={"email": "hash@forkast.app", "password": "password123"})

    stored = await session.scalar(select(User).where(User.email == "hash@forkast.app"))
    assert stored is not None
    assert stored.password_hash != "password123"
    assert stored.password_hash.startswith("$argon2")


async def test_login_succeeds_with_correct_credentials(client: AsyncClient) -> None:
    await client.post(REGISTER, json={"email": "login@forkast.app", "password": "password123"})

    response = await client.post(
        LOGIN, json={"email": "login@forkast.app", "password": "password123"}
    )

    assert response.status_code == 200
    assert response.json()["access_token"]


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("login2@forkast.app", "wrongpassword"),
        ("nobody@forkast.app", "password123"),
    ],
)
async def test_login_gives_the_same_error_for_bad_password_and_unknown_email(
    client: AsyncClient, email: str, password: str
) -> None:
    """Otherwise the endpoint tells an attacker which emails are registered."""
    await client.post(REGISTER, json={"email": "login2@forkast.app", "password": "password123"})

    response = await client.post(LOGIN, json={"email": email, "password": password})

    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"


async def test_refresh_rotates_the_token_and_kills_the_old_one(client: AsyncClient) -> None:
    registered = (
        await client.post(
            REGISTER, json={"email": "rotate@forkast.app", "password": "password123"}
        )
    ).json()
    original_refresh = registered["refresh_token"]

    first = await client.post(REFRESH, json={"refresh_token": original_refresh})
    assert first.status_code == 200
    rotated = first.json()["refresh_token"]
    assert rotated != original_refresh

    # Replaying the original must now fail, which is the whole point of rotation.
    replay = await client.post(REFRESH, json={"refresh_token": original_refresh})
    assert replay.status_code == 401

    # The rotated one still works.
    assert (await client.post(REFRESH, json={"refresh_token": rotated})).status_code == 200


async def test_refresh_tokens_are_stored_only_as_a_hash(
    client: AsyncClient, session: AsyncSession
) -> None:
    registered = (
        await client.post(REGISTER, json={"email": "hashed@forkast.app", "password": "password123"})
    ).json()
    raw = registered["refresh_token"]

    assert await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == raw)) is None
    stored = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
    )
    assert stored is not None


async def test_logout_revokes_the_refresh_token(client: AsyncClient) -> None:
    registered = (
        await client.post(REGISTER, json={"email": "out@forkast.app", "password": "password123"})
    ).json()
    refresh_token = registered["refresh_token"]

    assert (await client.post(LOGOUT, json={"refresh_token": refresh_token})).status_code == 204
    assert (await client.post(REFRESH, json={"refresh_token": refresh_token})).status_code == 401


async def test_logout_is_idempotent(client: AsyncClient) -> None:
    registered = (
        await client.post(REGISTER, json={"email": "out2@forkast.app", "password": "password123"})
    ).json()
    token = registered["refresh_token"]

    assert (await client.post(LOGOUT, json={"refresh_token": token})).status_code == 204
    assert (await client.post(LOGOUT, json={"refresh_token": token})).status_code == 204


async def test_me_returns_the_authenticated_user(client: AsyncClient) -> None:
    registered = (
        await client.post(REGISTER, json={"email": "me@forkast.app", "password": "password123"})
    ).json()

    response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {registered['access_token']}"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "me@forkast.app"
    assert body["goal"] == "maintain"
    assert body["timezone"] == "Asia/Karachi"


@pytest.mark.parametrize(
    "path",
    ["/api/v1/logs", "/api/v1/dashboard", "/api/v1/streaks", "/api/v1/cuisines", "/api/v1/me"],
)
async def test_protected_routes_reject_an_anonymous_caller(
    client: AsyncClient, path: str
) -> None:
    assert (await client.get(path)).status_code == 401


async def test_a_garbage_token_is_rejected(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


async def test_health_needs_no_authentication(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_register_commits_before_the_response_is_returned(
    client: AsyncClient, session_factory
) -> None:
    """Regression: the data must be durable by the time the client has the token.

    FastAPI runs the exit half of a yield dependency AFTER the response is sent.
    While the session dependency committed there, a client could register, then
    immediately use the returned refresh token and get a 401 because the row was
    not visible yet. A separate session is used here deliberately: it can only
    see committed rows.
    """
    response = await client.post(
        REGISTER, json={"email": "durable@forkast.app", "password": "password123"}
    )
    assert response.status_code == 201
    raw_refresh = response.json()["refresh_token"]

    async with session_factory() as fresh:
        user = await fresh.scalar(select(User).where(User.email == "durable@forkast.app"))
        assert user is not None, "user was not committed before the response returned"

        token = await fresh.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_refresh))
        )
        assert token is not None, "refresh token was not committed before the response returned"


async def test_a_token_works_immediately_after_registering(client: AsyncClient) -> None:
    """The end to end shape of the same race, exercised through the API."""
    registered = (
        await client.post(
            REGISTER, json={"email": "immediate@forkast.app", "password": "password123"}
        )
    ).json()

    refreshed = await client.post(REFRESH, json={"refresh_token": registered["refresh_token"]})
    assert refreshed.status_code == 200, refreshed.text

    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {registered['access_token']}"}
    )
    assert me.status_code == 200
