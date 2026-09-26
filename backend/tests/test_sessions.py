"""The caller can list only their own currently live session families."""

from __future__ import annotations

import datetime as dt
import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken, User
from app.services.security import create_access_token, hash_refresh_token

SESSIONS = "/api/v1/auth/sessions"
ME = "/api/v1/me"
REFRESH = "/api/v1/auth/refresh"


def _make_session(user_id: uuid.UUID, label: str) -> tuple[uuid.UUID, str, str, RefreshToken]:
    session_id = uuid.uuid4()
    raw_refresh = f"{label}-refresh-token"
    access_token, _ = create_access_token(user_id, session_id)
    refresh_row = RefreshToken(
        user_id=user_id,
        session_id=session_id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(days=30),
    )
    return session_id, access_token, raw_refresh, refresh_row


async def test_list_sessions(client: AsyncClient, session: AsyncSession) -> None:
    now = dt.datetime.now(dt.UTC)
    user = User(email="sessions@forkast.app", password_hash="test-hash")
    another_user = User(email="other-sessions@forkast.app", password_hash="test-hash")
    session.add_all([user, another_user])
    await session.flush()

    current_session_id = uuid.uuid4()
    other_session_id = uuid.uuid4()
    expired_session_id = uuid.uuid4()
    revoked_session_id = uuid.uuid4()
    current_token, _ = create_access_token(user.id, current_session_id)

    token_rows = [
        RefreshToken(
            user_id=user.id,
            session_id=current_session_id,
            token_hash=hash_refresh_token("current-old-refresh"),
            expires_at=now + dt.timedelta(days=5),
            created_at=now - dt.timedelta(days=3),
        ),
        RefreshToken(
            user_id=user.id,
            session_id=current_session_id,
            token_hash=hash_refresh_token("current-new-refresh"),
            expires_at=now + dt.timedelta(days=30),
            created_at=now - dt.timedelta(days=1),
        ),
        RefreshToken(
            user_id=user.id,
            session_id=current_session_id,
            token_hash=hash_refresh_token("current-revoked-refresh"),
            expires_at=now + dt.timedelta(days=30),
            revoked_at=now - dt.timedelta(hours=1),
            created_at=now - dt.timedelta(days=10),
        ),
        RefreshToken(
            user_id=user.id,
            session_id=other_session_id,
            token_hash=hash_refresh_token("other-live-refresh"),
            expires_at=now + dt.timedelta(days=10),
            created_at=now - dt.timedelta(days=2),
        ),
        RefreshToken(
            user_id=user.id,
            session_id=expired_session_id,
            token_hash=hash_refresh_token("expired-refresh"),
            expires_at=now - dt.timedelta(seconds=1),
            created_at=now - dt.timedelta(days=4),
        ),
        RefreshToken(
            user_id=user.id,
            session_id=revoked_session_id,
            token_hash=hash_refresh_token("revoked-refresh"),
            expires_at=now + dt.timedelta(days=1),
            revoked_at=now - dt.timedelta(minutes=1),
            created_at=now - dt.timedelta(days=5),
        ),
        RefreshToken(
            user_id=another_user.id,
            session_id=uuid.uuid4(),
            token_hash=hash_refresh_token("another-users-refresh"),
            expires_at=now + dt.timedelta(days=1),
            created_at=now - dt.timedelta(days=6),
        ),
    ]
    session.add_all(token_rows)
    await session.commit()

    response = await client.get(SESSIONS, headers={"Authorization": f"Bearer {current_token}"})

    assert response.status_code == 200, response.text
    rows = response.json()
    assert len(rows) == 2
    assert {row["session_id"] for row in rows} == {
        str(current_session_id),
        str(other_session_id),
    }
    by_id = {row["session_id"]: row for row in rows}
    assert by_id[str(current_session_id)]["is_current"] is True
    assert by_id[str(other_session_id)]["is_current"] is False
    assert dt.datetime.fromisoformat(by_id[str(current_session_id)]["created_at"]) == (
        now - dt.timedelta(days=3)
    )


async def test_revoke_one_session(client: AsyncClient, session: AsyncSession) -> None:
    user = User(email="revoke-one@forkast.app", password_hash="test-hash")
    session.add(user)
    await session.flush()

    current_id, current_access, current_refresh, current_row = _make_session(user.id, "one-current")
    target_id, target_access, target_refresh, target_row = _make_session(user.id, "one-target")
    session.add_all([current_row, target_row])
    await session.commit()

    response = await client.delete(
        f"{SESSIONS}/{target_id}", headers={"Authorization": f"Bearer {current_access}"}
    )

    assert response.status_code == 204
    assert (
        await client.get(ME, headers={"Authorization": f"Bearer {current_access}"})
    ).status_code == 200
    assert (
        await client.get(ME, headers={"Authorization": f"Bearer {target_access}"})
    ).status_code == 401
    assert (await client.post(REFRESH, json={"refresh_token": target_refresh})).status_code == 401
    assert (await client.post(REFRESH, json={"refresh_token": current_refresh})).status_code == 200
    remaining = await session.scalars(
        select(RefreshToken.session_id).where(RefreshToken.user_id == user.id)
    )
    assert set(remaining.all()) == {current_id}


async def test_revoke_others_keeps_current(client: AsyncClient, session: AsyncSession) -> None:
    user = User(email="revoke-others@forkast.app", password_hash="test-hash")
    session.add(user)
    await session.flush()

    current_id, current_access, current_refresh, current_row = _make_session(
        user.id, "others-current"
    )
    other_sessions = [
        _make_session(user.id, "others-first"),
        _make_session(user.id, "others-second"),
    ]
    session.add_all([current_row, *(item[3] for item in other_sessions)])
    await session.commit()

    response = await client.post(
        f"{SESSIONS}/revoke-others",
        headers={"Authorization": f"Bearer {current_access}"},
    )

    assert response.status_code == 204
    assert (
        await client.get(ME, headers={"Authorization": f"Bearer {current_access}"})
    ).status_code == 200
    assert (await client.post(REFRESH, json={"refresh_token": current_refresh})).status_code == 200
    for _, access_token, refresh_token, _ in other_sessions:
        assert (
            await client.get(ME, headers={"Authorization": f"Bearer {access_token}"})
        ).status_code == 401
        assert (
            await client.post(REFRESH, json={"refresh_token": refresh_token})
        ).status_code == 401

    remaining = await session.scalars(
        select(RefreshToken.session_id).where(RefreshToken.user_id == user.id)
    )
    assert set(remaining.all()) == {current_id}


async def test_cannot_revoke_someone_elses_session(
    client: AsyncClient, session: AsyncSession
) -> None:
    requester = User(email="session-requester@forkast.app", password_hash="test-hash")
    owner = User(email="session-owner@forkast.app", password_hash="test-hash")
    session.add_all([requester, owner])
    await session.flush()

    _, requester_access, _, requester_row = _make_session(requester.id, "requester")
    owner_session_id, owner_access, owner_refresh, owner_row = _make_session(owner.id, "owner")
    session.add_all([requester_row, owner_row])
    await session.commit()

    response = await client.delete(
        f"{SESSIONS}/{owner_session_id}",
        headers={"Authorization": f"Bearer {requester_access}"},
    )

    assert response.status_code == 404
    assert (
        await client.get(ME, headers={"Authorization": f"Bearer {owner_access}"})
    ).status_code == 200
    assert (await client.post(REFRESH, json={"refresh_token": owner_refresh})).status_code == 200
