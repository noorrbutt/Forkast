"""Password reset delivery, token use, and session revocation."""

from __future__ import annotations

import datetime as dt
import secrets
import uuid
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PasswordResetToken, RefreshToken, User
from app.services import email as email_service
from app.services.security import hash_refresh_token, verify_password_async

FORGOT = "/api/v1/auth/forgot-password"
RESET = "/api/v1/auth/reset-password"


def _mock_resend(monkeypatch: pytest.MonkeyPatch, *, side_effect=None) -> Mock:
    send = Mock(side_effect=side_effect)
    client = SimpleNamespace(Emails=SimpleNamespace(send=send))
    settings = SimpleNamespace(
        resend_api_key=SecretStr("re_test_key"),
        resend_from_email="Forkast <noreply@example.test>",
    )
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(email_service, "init_resend_client", lambda: client)
    return send


async def test_forgot_password_returns_202_when_resend_raises(
    client: AsyncClient,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    send = _mock_resend(monkeypatch, side_effect=RuntimeError("provider unavailable"))
    user = User(
        email="reset-delivery@forkast.app",
        password_hash="existing-hash",
        email_verified=True,
    )
    session.add(user)
    await session.commit()

    response = await client.post(FORGOT, json={"email": user.email})

    assert response.status_code == 202
    assert send.call_count == 1
    params = send.call_args.args[0]
    assert params["to"] == [user.email]
    assert "forkast://reset-password?token=" in params["text"]
    stored = await session.scalar(
        select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
    )
    assert stored is not None
    assert (
        dt.timedelta(minutes=30)
        <= stored.expires_at - stored.created_at
        <= dt.timedelta(minutes=60)
    )
    raw_token = parse_qs(urlsplit(params["text"].split(": ", 1)[1]).query)["token"][0]
    assert stored.token_hash == hash_refresh_token(raw_token)
    assert stored.token_hash != raw_token


async def test_forgot_password_returns_202_for_unknown_and_unverified_emails(
    client: AsyncClient,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    send = _mock_resend(monkeypatch)
    user = User(email="unverified-reset@forkast.app", password_hash="existing-hash")
    verified = User(
        email="verified-reset@forkast.app",
        password_hash="existing-hash",
        email_verified=True,
    )
    session.add_all([user, verified])
    await session.commit()

    unknown = await client.post(FORGOT, json={"email": "unknown-reset@forkast.app"})
    unverified = await client.post(FORGOT, json={"email": user.email})
    already_verified = await client.post(FORGOT, json={"email": verified.email})

    assert unknown.status_code == 202
    assert unverified.status_code == 202
    assert already_verified.status_code == 202
    assert send.call_count == 0
    assert (
        await session.scalar(
            select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        )
        is None
    )


async def test_reset_hashes_password_preserves_verification_and_revokes_all_sessions(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    user = User(
        email="reset-password@forkast.app",
        password_hash="old-hash",
        email_verified=False,
    )
    session.add(user)
    await session.flush()
    raw_token = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_token),
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30),
    )
    sessions = [
        RefreshToken(
            user_id=user.id,
            session_id=uuid.uuid4(),
            token_hash=hash_refresh_token(f"refresh-{index}"),
            expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(days=1),
        )
        for index in range(2)
    ]
    session.add_all([reset_token, *sessions])
    await session.commit()

    response = await client.post(
        RESET,
        json={"token": raw_token, "new_password": "a-new-secure-password"},
    )

    assert response.status_code == 200
    await session.refresh(user)
    await session.refresh(reset_token)
    assert await verify_password_async("a-new-secure-password", user.password_hash or "")
    assert user.email_verified is False
    assert reset_token.used_at is not None
    stored_sessions = await session.scalars(
        select(RefreshToken).where(RefreshToken.user_id == user.id)
    )
    assert stored_sessions.all() == []

    replay = await client.post(
        RESET,
        json={"token": raw_token, "new_password": "another-secure-password"},
    )
    assert replay.status_code == 400


async def test_expired_password_reset_token_is_rejected(
    client: AsyncClient,
    session: AsyncSession,
) -> None:
    user = User(email="expired-reset@forkast.app", password_hash="old-hash")
    session.add(user)
    await session.flush()
    raw_token = secrets.token_urlsafe(32)
    session.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_refresh_token(raw_token),
            expires_at=dt.datetime.now(dt.UTC) - dt.timedelta(seconds=1),
        )
    )
    await session.commit()

    response = await client.post(
        RESET,
        json={"token": raw_token, "new_password": "a-new-secure-password"},
    )

    assert response.status_code == 400
