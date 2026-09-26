"""Email verification tokens, delivery, and enumeration-safe resend behavior."""

from __future__ import annotations

import datetime as dt
import secrets
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import EmailVerificationToken, User
from app.services import email as email_service
from app.services.security import hash_refresh_token

REGISTER = "/api/v1/auth/register"
VERIFY = "/api/v1/auth/verify-email"
RESEND = "/api/v1/auth/resend-verification"


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


def _registration(email: str) -> dict[str, str]:
    return {
        "first_name": "Test",
        "last_name": "User",
        "email": email,
        "password": "password123",
    }


def _settings_args() -> dict[str, str]:
    return {
        "ENVIRONMENT": "dev",
        "DATABASE_URL": "postgresql+asyncpg://user:pass@localhost:5432/forkast",
        "TEST_DATABASE_URL": "postgresql+asyncpg://user:pass@localhost:5432/forkast_test",
        "JWT_SECRET": "test-secret-that-is-long-enough-for-validation",
        "AI_PROVIDER": "fake",
    }


def test_resend_settings_must_be_configured_together() -> None:
    with pytest.raises(ValidationError, match="RESEND_API_KEY and RESEND_FROM_EMAIL"):
        Settings(_env_file=None, **_settings_args(), RESEND_API_KEY="re_test_key")

    with pytest.raises(ValidationError, match="RESEND_API_KEY and RESEND_FROM_EMAIL"):
        Settings(
            _env_file=None,
            **_settings_args(),
            RESEND_FROM_EMAIL="Forkast <noreply@example.test>",
        )


async def test_registration_sends_a_hashed_verification_token(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    send = _mock_resend(monkeypatch)
    response = await client.post(REGISTER, json=_registration("verify@forkast.app"))

    assert response.status_code == 201
    assert send.call_count == 1
    params = send.call_args.args[0]
    assert params["from"] == "Forkast <noreply@example.test>"
    assert params["to"] == ["verify@forkast.app"]
    assert "forkast://check-email?token=" in params["text"]

    user = await session.scalar(select(User).where(User.email == "verify@forkast.app"))
    assert user is not None
    assert user.email_verified is False
    stored = await session.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id)
    )
    assert stored is not None
    raw_token = parse_qs(urlsplit(params["text"].split(": ", maxsplit=1)[1]).query)["token"][0]
    assert stored.token_hash == hash_refresh_token(raw_token)
    assert stored.token_hash != raw_token


async def test_registration_succeeds_when_resend_raises(
    client: AsyncClient,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    send = _mock_resend(monkeypatch, side_effect=RuntimeError("provider unavailable"))
    response = await client.post(REGISTER, json=_registration("delivery-failure@forkast.app"))

    assert response.status_code == 201
    assert response.json()["access_token"]
    assert send.call_count == 1
    user = await session.scalar(select(User).where(User.email == "delivery-failure@forkast.app"))
    assert user is not None
    assert user.email_verified is False


async def test_verification_marks_user_verified_and_consumes_token(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = User(email="verify-token@forkast.app", password_hash="test-hash")
    session.add(user)
    await session.flush()
    raw_token = secrets.token_urlsafe(32)
    stored = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_token),
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(hours=1),
    )
    session.add(stored)
    await session.commit()

    response = await client.post(VERIFY, json={"token": raw_token})

    assert response.status_code == 200
    assert response.json() == {"detail": "Email verified."}
    await session.refresh(user)
    await session.refresh(stored)
    assert user.email_verified is True
    assert stored.used_at is not None
    replay = await client.post(VERIFY, json={"token": raw_token})
    assert replay.status_code == 400


async def test_resend_is_enumeration_safe_for_unknown_and_verified_accounts(
    client: AsyncClient,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    send = _mock_resend(monkeypatch)
    user = User(email="resend@forkast.app", password_hash="test-hash")
    verified = User(email="verified@forkast.app", password_hash="test-hash", email_verified=True)
    session.add_all([user, verified])
    await session.commit()

    unknown = await client.post(RESEND, json={"email": "unknown@forkast.app"})
    unverified = await client.post(RESEND, json={"email": "resend@forkast.app"})
    already_verified = await client.post(RESEND, json={"email": "verified@forkast.app"})

    assert [unknown.status_code, unverified.status_code, already_verified.status_code] == [
        202,
        202,
        202,
    ]
    assert send.call_count == 1
    token = await session.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id)
    )
    assert token is not None


async def test_expired_verification_token_is_rejected(
    client: AsyncClient, session: AsyncSession
) -> None:
    user = User(email="expired@forkast.app", password_hash="test-hash")
    session.add(user)
    await session.flush()
    raw_token = secrets.token_urlsafe(32)
    session.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=hash_refresh_token(raw_token),
            expires_at=dt.datetime.now(dt.UTC) - dt.timedelta(seconds=1),
        )
    )
    await session.commit()

    response = await client.post(VERIFY, json={"token": raw_token})

    assert response.status_code == 400
