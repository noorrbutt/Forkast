"""App Links / Universal Links: the two /.well-known files and the fallback
pages a reset or verification link opens to outside the app."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.config import get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    # get_settings() is lru_cache'd; monkeypatching env vars mid-suite would
    # not be seen without this.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_apple_app_site_association_is_404_when_unconfigured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An empty or placeholder verification file is worse than no file at
    all: it would tell iOS this domain verified and then name an app that
    does not exist."""
    monkeypatch.delenv("APP_DOMAIN", raising=False)
    monkeypatch.delenv("APPLE_APP_ID_PREFIX", raising=False)

    response = await client.get("/.well-known/apple-app-site-association")
    assert response.status_code == 404


async def test_apple_app_site_association_when_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_DOMAIN", "forkast.app")
    monkeypatch.setenv("APPLE_APP_ID_PREFIX", "ABCDE12345")

    response = await client.get("/.well-known/apple-app-site-association")
    assert response.status_code == 200
    body = response.json()
    detail = body["applinks"]["details"][0]
    assert detail["appID"] == "ABCDE12345.com.forkast.app"
    assert "/reset-password" in detail["paths"]
    assert "/check-email" in detail["paths"]


async def test_assetlinks_is_404_when_unconfigured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("APP_DOMAIN", raising=False)
    monkeypatch.delenv("ANDROID_SHA256_CERT_FINGERPRINT", raising=False)

    response = await client.get("/.well-known/assetlinks.json")
    assert response.status_code == 404


async def test_assetlinks_when_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_DOMAIN", "forkast.app")
    monkeypatch.setenv("ANDROID_SHA256_CERT_FINGERPRINT", "AA:BB:CC")

    response = await client.get("/.well-known/assetlinks.json")
    assert response.status_code == 200
    body = response.json()
    assert body[0]["target"]["package_name"] == "com.forkast.app"
    assert body[0]["target"]["sha256_cert_fingerprints"] == ["AA:BB:CC"]


async def test_reset_password_fallback_page_renders(client: AsyncClient) -> None:
    response = await client.get("/reset-password", params={"token": "abc123"})
    assert response.status_code == 200
    assert "forkast://reset-password?token=abc123" in response.text


async def test_fallback_page_escapes_a_token_that_looks_like_markup(
    client: AsyncClient,
) -> None:
    """The token comes straight off the query string and is untrusted the
    same way any query parameter is. It must never be able to break out of
    either the href attribute or the inline <script> block it also appears
    in."""
    hostile = '"><script>alert(1)</script>'
    response = await client.get("/reset-password", params={"token": hostile})
    assert response.status_code == 200
    # The href attribute's quote is properly escaped, so the token cannot
    # close it early.
    assert 'href="forkast://reset-password?token=&quot;&gt;' in response.text
    # And the </script> inside the token cannot close the real script block
    # early either, wherever the token appears.
    assert "<script>alert(1)</script>" not in response.text


def test_deep_link_helper_falls_back_to_the_custom_scheme_with_no_domain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import auth as auth_module

    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type("S", (), {"app_domain": ""})(),
    )
    link = auth_module._deep_link("reset-password", token="tok")
    assert link == "forkast://reset-password?token=tok"


def test_deep_link_helper_uses_https_when_a_domain_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import auth as auth_module

    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type("S", (), {"app_domain": "forkast.app"})(),
    )
    link = auth_module._deep_link("reset-password", token="tok")
    assert link == "https://forkast.app/reset-password?token=tok"
