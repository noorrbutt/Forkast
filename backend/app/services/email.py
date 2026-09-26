"""Server-side email delivery through Resend."""

from __future__ import annotations

from functools import lru_cache
from html import escape
from importlib import import_module
from typing import Any

from app.config import get_settings


@lru_cache(maxsize=1)
def init_resend_client() -> Any:
    """Configure the official SDK once from server-only settings."""
    settings = get_settings()
    api_key = settings.resend_api_key
    if api_key is None or not api_key.get_secret_value().strip():
        raise RuntimeError("RESEND_API_KEY is not configured")
    resend = import_module("resend")
    resend.api_key = api_key.get_secret_value().strip()
    return resend


def send_verification_email(to: str, link: str) -> None:
    """Send the one-time email verification link with Resend."""
    settings = get_settings()
    sender = settings.resend_from_email
    api_key = settings.resend_api_key
    if (
        api_key is None
        or not api_key.get_secret_value().strip()
        or not sender
        or not sender.strip()
    ):
        return

    client = init_resend_client()
    safe_link = escape(link, quote=True)
    client.Emails.send(
        {
            "from": sender,
            "to": [to],
            "subject": "Verify your Forkast email",
            "html": (
                '<p>Confirm this email address for your Forkast account.</p>'
                f'<p><a href="{safe_link}">Verify email address</a></p>'
            ),
            "text": f"Verify your email address: {link}",
        }
    )