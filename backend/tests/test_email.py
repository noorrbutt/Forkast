"""The sender object sent to Brevo.

Brevo's send API falls back to the account's own default -- or rewrites the
visible From outright, for an unauthenticated sender -- the moment a request
omits sender.name. This is what guards against that regressing again: the
name has to be in every outgoing payload, not just present in config.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import SecretStr

from app.services import email as email_service


def _settings(**overrides: object) -> SimpleNamespace:
    base = dict(
        brevo_api_key=SecretStr("xkeysib-test-key"),
        email_from_name="Forkast",
        email_from_address="noreply@example.test",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_sender_name_is_always_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    send = Mock()
    monkeypatch.setattr(email_service, "get_settings", lambda: _settings())
    monkeypatch.setattr(email_service, "send_via_brevo", send)

    email_service.send_verification_email(
        "someone@forkast.app", "https://forkast.app/check-email?token=abc"
    )

    assert send.call_count == 1
    payload = send.call_args.args[0]
    assert payload["sender"] == {"name": "Forkast", "email": "noreply@example.test"}


def test_sender_name_follows_email_from_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """Not hardcoded: a deploy that sets EMAIL_FROM_NAME to something else
    gets that name, not a literal "Forkast" baked into the send path."""
    send = Mock()
    monkeypatch.setattr(
        email_service, "get_settings", lambda: _settings(email_from_name="Forkast Staging")
    )
    monkeypatch.setattr(email_service, "send_via_brevo", send)

    email_service.send_password_reset_email(
        "someone@forkast.app", "https://forkast.app/reset-password?token=abc"
    )

    payload = send.call_args.args[0]
    assert payload["sender"]["name"] == "Forkast Staging"


def test_nothing_is_sent_when_no_sender_address_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    send = Mock()
    monkeypatch.setattr(email_service, "get_settings", lambda: _settings(email_from_address=""))
    monkeypatch.setattr(email_service, "send_via_brevo", send)

    email_service.send_verification_email(
        "someone@forkast.app", "https://forkast.app/check-email?token=abc"
    )

    send.assert_not_called()
