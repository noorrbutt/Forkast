"""The caller can list only their own currently live session families."""

from __future__ import annotations

import datetime as dt
import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken, User
from app.services.security import create_access_token, hash_refresh_token

SESSIONS = "/api/v1/auth/sessions"


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