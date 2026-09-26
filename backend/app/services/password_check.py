"""Check passwords against the Have I Been Pwned range API."""

from __future__ import annotations

import hashlib
import logging

import httpx

logger = logging.getLogger(__name__)
HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/{}"
REQUEST_TIMEOUT_SECONDS = 2.5


def is_password_breached(password: str) -> bool:
    """Return whether HIBP knows this password, failing open on API errors.

    Only the first five hexadecimal characters of the SHA-1 digest are sent.
    The full password and full digest stay local.
    """
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()  # noqa: S324
    prefix, suffix = digest[:5], digest[5:]

    try:
        response = httpx.get(
            HIBP_RANGE_URL.format(prefix),
            headers={"Add-Padding": "true"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        for line in response.text.splitlines():
            candidate, separator, _count = line.partition(":")
            if separator and candidate.strip().upper() == suffix:
                return True
        return False
    except Exception as exc:
        logger.warning("HIBP password check failed; failing open: %s", exc)
        return False
