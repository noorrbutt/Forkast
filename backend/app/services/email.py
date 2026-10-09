"""Server-side email delivery through Brevo's transactional email API."""

from __future__ import annotations

import logging
from email.utils import parseaddr
from html import escape
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"


def _send_link_email(to: str, link: str, *, subject: str, intro: str, action: str) -> None:
    settings = get_settings()
    api_key = settings.brevo_api_key
    sender = settings.brevo_from_email
    has_key = api_key is not None and bool(api_key.get_secret_value().strip())
    has_sender = bool(sender and sender.strip())
    if not has_key or not has_sender:
        # Deliberately a no-op rather than an error: local dev, CI and tests
        # all run with no Brevo credentials configured, and none of them
        # should need one just to register a user. But the job handler that
        # calls this treats a plain return as success and marks the job done,
        # so without a log line here, a deployment that forgot to set
        # BREVO_API_KEY / BREVO_FROM_EMAIL sends nothing and nothing ever
        # says why -- every verification and reset email vanishes silently.
        logger.warning(
            "email_send_skipped_no_provider to=%s subject=%r missing=%s",
            to,
            subject,
            "BREVO_API_KEY" if not has_key else "BREVO_FROM_EMAIL",
        )
        return

    # Accepts either a plain address or the "Name <address>" form, the same
    # shape RESEND_FROM_EMAIL used to take, so an existing sender value keeps
    # working unchanged.
    name, address = parseaddr(sender)
    safe_link = escape(link, quote=True)
    payload: dict[str, Any] = {
        "sender": {"email": address, "name": name} if name else {"email": address},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": f'<p>{intro}</p><p><a href="{safe_link}">{action}</a></p>',
        "textContent": f"{action}: {link}",
    }
    send_via_brevo(payload, api_key.get_secret_value().strip())


def send_via_brevo(payload: dict[str, Any], api_key: str) -> None:
    """The actual network call, isolated so a test can replace it without a live key."""
    response = httpx.post(
        BREVO_SEND_URL,
        headers={"api-key": api_key, "content-type": "application/json"},
        json=payload,
        timeout=10.0,
    )
    response.raise_for_status()


def send_verification_email(to: str, link: str) -> None:
    """Send the one-time email verification link through Brevo."""
    _send_link_email(
        to,
        link,
        subject="Verify your Forkast email",
        intro="Confirm this email address for your Forkast account.",
        action="Verify email address",
    )


def send_password_reset_email(to: str, link: str) -> None:
    """Send a one-time password reset link through Brevo."""
    _send_link_email(
        to,
        link,
        subject="Reset your Forkast password",
        intro="A password reset was requested for your Forkast account.",
        action="Reset password",
    )
