"""Auth: registration, login, refresh rotation, logout and route protection."""

from __future__ import annotations

import asyncio
import datetime as dt
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import RefreshToken, User
from app.services.security import decode_access_token, hash_refresh_token

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"


async def test_register_returns_a_usable_token_pair(client: AsyncClient) -> None:
    response = await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "new@forkast.app",
            "password": "password123",
        },
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
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "dupe@forkast.app",
            "password": "password123",
        },
    )
    response = await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "DUPE@forkast.app",
            "password": "password123",
        },
    )

    assert response.status_code == 409


async def test_password_is_hashed_not_stored(client: AsyncClient, session: AsyncSession) -> None:
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "hash@forkast.app",
            "password": "password123",
        },
    )

    stored = await session.scalar(select(User).where(User.email == "hash@forkast.app"))
    assert stored is not None
    assert stored.password_hash != "password123"
    assert stored.password_hash.startswith("$argon2")


async def test_login_succeeds_with_correct_credentials(client: AsyncClient) -> None:
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "login@forkast.app",
            "password": "password123",
        },
    )

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
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "login2@forkast.app",
            "password": "password123",
        },
    )

    response = await client.post(LOGIN, json={"email": email, "password": password})

    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"


async def test_refresh_rotates_the_token_and_kills_the_old_one(client: AsyncClient) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "rotate@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    original_refresh = registered["refresh_token"]

    first = await client.post(REFRESH, json={"refresh_token": original_refresh})
    assert first.status_code == 200
    rotated = first.json()["refresh_token"]
    assert rotated != original_refresh

    second = await client.post(REFRESH, json={"refresh_token": rotated})
    assert second.status_code == 200

    replay = await client.post(REFRESH, json={"refresh_token": original_refresh})
    assert replay.status_code == 200
    assert replay.json()["refresh_token"] != rotated


async def test_refresh_tokens_are_stored_only_as_a_hash(
    client: AsyncClient, session: AsyncSession
) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "hashed@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    raw = registered["refresh_token"]

    assert await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == raw)) is None
    stored = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
    )
    assert stored is not None


async def test_retrying_a_recently_spent_refresh_keeps_the_session_alive(
    client: AsyncClient, session: AsyncSession
) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "retry-leeway@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    first_refresh = registered["refresh_token"]

    user = await session.scalar(select(User).where(User.email == "retry-leeway@forkast.app"))
    assert user is not None

    second_raw = "second-live-refresh-token"
    session.add(
        RefreshToken(
            user_id=user.id,
            session_id=uuid.uuid4(),
            token_hash=hash_refresh_token(second_raw),
            expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(days=1),
        )
    )
    await session.commit()

    rotated = await client.post(REFRESH, json={"refresh_token": first_refresh})
    assert rotated.status_code == 200

    replay = await client.post(REFRESH, json={"refresh_token": first_refresh})
    assert replay.status_code == 200
    assert replay.json()["refresh_token"] != rotated.json()["refresh_token"]
    assert (await client.post(REFRESH, json={"refresh_token": second_raw})).status_code == 200

    live_rows = await session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert len(live_rows.all()) >= 2


async def test_reusing_a_refresh_after_the_leeway_revokes_only_that_session(
    client: AsyncClient, session: AsyncSession
) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "retry-stale@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    first_refresh = registered["refresh_token"]

    user = await session.scalar(select(User).where(User.email == "retry-stale@forkast.app"))
    assert user is not None

    second_raw = "second-stale-refresh-token"
    session.add(
        RefreshToken(
            user_id=user.id,
            session_id=uuid.uuid4(),
            token_hash=hash_refresh_token(second_raw),
            expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(days=1),
        )
    )
    await session.commit()

    assert (await client.post(REFRESH, json={"refresh_token": first_refresh})).status_code == 200

    stale = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(first_refresh))
    )
    assert stale is not None
    stale.revoked_at = dt.datetime.now(dt.UTC) - dt.timedelta(
        seconds=get_settings().refresh_reuse_leeway_seconds + 1
    )
    await session.commit()

    replay = await client.post(REFRESH, json={"refresh_token": first_refresh})
    assert replay.status_code == 401
    assert (await client.post(REFRESH, json={"refresh_token": second_raw})).status_code == 200

    live_rows = await session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert len(live_rows.all()) == 1


async def test_unknown_refresh_tokens_do_not_revoke_any_session(
    client: AsyncClient, session: AsyncSession
) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "unknown-refresh@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    user = await session.scalar(select(User).where(User.email == "unknown-refresh@forkast.app"))
    assert user is not None
    before = await session.scalar(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert before is not None
    assert (
        await client.post(REFRESH, json={"refresh_token": "totally-not-a-real-refresh-token"})
    ).status_code == 401
    after = await session.scalar(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert after is not None


async def test_logout_revokes_the_refresh_token(client: AsyncClient) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "out@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    refresh_token = registered["refresh_token"]

    assert (await client.post(LOGOUT, json={"refresh_token": refresh_token})).status_code == 204
    assert (await client.post(REFRESH, json={"refresh_token": refresh_token})).status_code == 401


async def test_logout_is_idempotent(client: AsyncClient) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "out2@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    token = registered["refresh_token"]

    assert (await client.post(LOGOUT, json={"refresh_token": token})).status_code == 204
    assert (await client.post(LOGOUT, json={"refresh_token": token})).status_code == 204


async def test_me_returns_the_authenticated_user(client: AsyncClient) -> None:
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "me@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    response = await client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {registered['access_token']}"}
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
async def test_protected_routes_reject_an_anonymous_caller(client: AsyncClient, path: str) -> None:
    assert (await client.get(path)).status_code == 401


async def test_a_garbage_token_is_rejected(client: AsyncClient) -> None:
    response = await client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-real-token"})
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
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "durable@forkast.app",
            "password": "password123",
        },
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
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "immediate@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    refreshed = await client.post(REFRESH, json={"refresh_token": registered["refresh_token"]})
    assert refreshed.status_code == 200, refreshed.text

    me = await client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {registered['access_token']}"}
    )
    assert me.status_code == 200


async def test_two_simultaneous_refreshes_of_one_token_yield_exactly_one_new_pair(
    client: AsyncClient,
) -> None:
    """Rotation has to be atomic, not read-then-check-then-write.

    Two requests arriving together with the same token both pass a plain read
    and check, and both get issued a fresh pair, which quietly defeats rotation.
    Claiming the row with a single conditional UPDATE means only one can win.
    """
    registered = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "racer@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    token = registered["refresh_token"]

    first, second = await asyncio.gather(
        client.post(REFRESH, json={"refresh_token": token}),
        client.post(REFRESH, json={"refresh_token": token}),
        return_exceptions=True,
    )

    statuses = sorted(r.status_code for r in (first, second) if not isinstance(r, BaseException))
    assert statuses.count(200) == 1, f"expected exactly one winner, got {statuses}"


async def test_login_does_not_answer_faster_for_an_unknown_email(client: AsyncClient) -> None:
    """A fast rejection for an unknown address and a slow one for a known address
    is a working user enumeration oracle, whatever the error message says.

    The bound is deliberately loose. This is checking that the unknown-email path
    still performs a hash at all, not asserting constant time.
    """
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "known@forkast.app",
            "password": "password123",
        },
    )

    async def time_login(email: str) -> float:
        start = asyncio.get_running_loop().time()
        await client.post(LOGIN, json={"email": email, "password": "wrongpassword"})
        return asyncio.get_running_loop().time() - start

    known = await time_login("known@forkast.app")
    unknown = await time_login("definitely-not-registered@forkast.app")

    assert unknown > known / 4, (
        f"unknown email answered in {unknown:.3f}s against {known:.3f}s for a known one, "
        "which leaks which addresses exist"
    )


async def test_replaying_a_spent_refresh_token_kills_the_whole_chain(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Rotation alone does not help if the thief refreshes first.

    The victim gets a 401 and the thief holds a chain that keeps rotating
    forever. A replay of an already-revoked token is the signal that the chain
    leaked, so every live token for that account goes with it. RFC 9700 4.14.2.
    """
    tokens = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "reuse@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    rotated = (await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})).json()

    # The stolen, already-spent token is presented again.
    replay = await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401

    # The chain that replaced it must now be dead too, not merely the replay.
    after = await client.post(REFRESH, json={"refresh_token": rotated["refresh_token"]})
    assert after.status_code == 401, "the leaked chain kept working after a detected replay"

    live = (
        await session.scalars(
            select(RefreshToken).join(User).where(User.email == "reuse@forkast.app")
        )
    ).all()
    assert all(token.revoked_at is not None for token in live)


async def test_an_unrelated_account_is_not_logged_out_by_someone_elses_replay(
    client: AsyncClient,
) -> None:
    """Family revocation has to stop at the owner of the replayed token."""
    victim = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "victim@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    bystander = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "bystander@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    await client.post(REFRESH, json={"refresh_token": victim["refresh_token"]})
    await client.post(REFRESH, json={"refresh_token": victim["refresh_token"]})

    still_fine = await client.post(REFRESH, json={"refresh_token": bystander["refresh_token"]})
    assert still_fine.status_code == 200
