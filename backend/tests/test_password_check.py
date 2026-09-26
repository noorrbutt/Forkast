"""Have I Been Pwned password range checks never send the full secret."""

from __future__ import annotations

import hashlib
import logging

import httpx

from app.services.password_check import REQUEST_TIMEOUT_SECONDS, is_password_breached


def test_known_breached_password_matches_returned_suffix(monkeypatch) -> None:
    calls: list[tuple[str, dict]] = []
    suffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"

    def fake_get(url: str, **kwargs) -> httpx.Response:
        calls.append((url, kwargs))
        return httpx.Response(200, request=httpx.Request("GET", url), text=f"{suffix}:3861493\n")

    monkeypatch.setattr(httpx, "get", fake_get)

    assert is_password_breached("password") is True
    assert calls == [
        (
            "https://api.pwnedpasswords.com/range/5BAA6",
            {"headers": {"Add-Padding": "true"}, "timeout": REQUEST_TIMEOUT_SECONDS},
        )
    ]
    assert suffix not in calls[0][0]


def test_clean_password_with_no_returned_suffix_is_not_breached(monkeypatch) -> None:
    digest = hashlib.sha1(b"a unique test password").hexdigest().upper()  # noqa: S324
    returned_suffix = "0" * (len(digest) - 5)
    seen_urls: list[str] = []

    def fake_get(url: str, **_kwargs) -> httpx.Response:
        seen_urls.append(url)
        return httpx.Response(200, request=httpx.Request("GET", url), text=f"{returned_suffix}:1\n")

    monkeypatch.setattr(httpx, "get", fake_get)

    assert is_password_breached("a unique test password") is False
    assert seen_urls == [f"https://api.pwnedpasswords.com/range/{digest[:5]}"]
    assert digest not in seen_urls[0]


def test_unreachable_api_fails_open_and_logs_warning(monkeypatch, caplog) -> None:
    def fake_get(_url: str, **_kwargs) -> httpx.Response:
        raise httpx.ConnectError("service unavailable")

    monkeypatch.setattr(httpx, "get", fake_get)

    with caplog.at_level(logging.WARNING, logger="app.services.password_check"):
        assert is_password_breached("another password") is False

    assert "HIBP password check failed; failing open" in caplog.text
