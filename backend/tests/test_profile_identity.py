"""Editing a name or an email address from PATCH /me.

Names are a plain column write, same as goal or timezone. Email is not: the
address has to stay unique, and email_verified means "this address was
proved", which stops being true the moment it changes -- Google or the
verification link having proved the OLD address says nothing about who
controls the new one.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailVerificationToken, User
from app.services import email as email_service

ME = "/api/v1/me"


def _mock_resend(monkeypatch: pytest.MonkeyPatch) -> Mock:
    send = Mock()
    client = SimpleNamespace(Emails=SimpleNamespace(send=send))
    settings = SimpleNamespace(
        resend_api_key=SecretStr("re_test_key"),
        resend_from_email="Forkast <noreply@example.test>",
    )
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(email_service, "init_resend_client", lambda: client)
    return send


async def test_first_and_last_name_can_be_changed(auth_client: AsyncClient) -> None:
    response = await auth_client.patch(ME, json={"first_name": "Sara", "last_name": "Khan"})

    assert response.status_code == 200
    body = response.json()
    assert body["first_name"] == "Sara"
    assert body["last_name"] == "Khan"


async def test_a_blank_name_is_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.patch(ME, json={"first_name": "   "})
    assert response.status_code == 422


async def test_changing_email_marks_it_unverified_and_sends_a_new_link(
    auth_client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    send = _mock_resend(monkeypatch)

    response = await auth_client.patch(ME, json={"email": "new-address@forkast.app"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "new-address@forkast.app"
    assert body["email_verified"] is False
    assert send.call_count == 1
    assert send.call_args.args[0]["to"] == ["new-address@forkast.app"]

    user = await session.scalar(select(User).where(User.email == "new-address@forkast.app"))
    assert user is not None
    assert user.email_verified is False

    token = await session.scalar(
        select(EmailVerificationToken).where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used_at.is_(None),
        )
    )
    assert token is not None


async def test_changing_to_an_email_already_in_use_is_a_conflict(
    client: AsyncClient, auth_client: AsyncClient
) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Taken",
            "last_name": "User",
            "email": "taken@forkast.app",
            "password": "password123",
        },
    )

    response = await auth_client.patch(ME, json={"email": "taken@forkast.app"})
    assert response.status_code == 409


async def test_setting_email_to_the_same_address_does_not_reset_verification(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    """Re-sending the same address back (an unrelated form field changing
    alongside it, say) must not needlessly knock a verified account back to
    unverified."""
    me = (await auth_client.get(ME)).json()
    user = await session.scalar(select(User).where(User.id == me["id"]))
    assert user is not None
    user.email_verified = True
    await session.commit()

    response = await auth_client.patch(ME, json={"email": me["email"], "first_name": "Same"})

    assert response.status_code == 200
    assert response.json()["email_verified"] is True


async def test_an_email_field_present_but_null_is_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.patch(ME, json={"email": None})
    assert response.status_code == 422
