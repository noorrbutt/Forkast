"""Transport hardening and rate limiting.

Everything here came out of a pentest pass that found the API would answer an
unlimited number of password guesses, buffer a request body of any size, send no
security headers at all, and keep honouring an access token after the user had
signed out.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.config import Settings, _rewrite_database_url, get_settings
from app.db import get_session
from app.main import app
from app.middleware import SECURITY_HEADERS

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
REFRESH = "/api/v1/auth/refresh"
LOGS = "/api/v1/logs"


def test_environment_is_required_without_an_env_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with pytest.raises(ValidationError, match=r"(?i)environment"):
        Settings(
            _env_file=None,
            DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/forkast",
            TEST_DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/forkast_test",
            JWT_SECRET="0" * 64,
            AI_PROVIDER="fake",
        )


@pytest.mark.parametrize(
    ("raw", "expected_async", "expected_sync"),
    [
        (
            "postgres://user:pass@db.example/app?sslmode=require",
            "postgresql+asyncpg://user:pass@db.example/app?ssl=require",
            "postgresql+psycopg://user:pass@db.example/app?sslmode=require",
        ),
        (
            "postgresql://user:pass@db.example/app?sslmode=verify-full",
            "postgresql+asyncpg://user:pass@db.example/app?ssl=verify-full",
            "postgresql+psycopg://user:pass@db.example/app?sslmode=verify-full",
        ),
        (
            "postgresql://user:pass@db.example/app?ssl=require",
            "postgresql+asyncpg://user:pass@db.example/app?ssl=require",
            "postgresql+psycopg://user:pass@db.example/app?sslmode=require",
        ),
    ],
)
def test_database_urls_are_rewritten_for_asyncpg_and_psycopg(
    raw: str, expected_async: str, expected_sync: str
) -> None:
    assert _rewrite_database_url(raw, async_driver=True) == expected_async
    assert _rewrite_database_url(raw, async_driver=False) == expected_sync


async def test_every_response_carries_the_security_headers(client: AsyncClient) -> None:
    response = await client.get("/health")

    for header, value in SECURITY_HEADERS.items():
        assert response.headers.get(header) == value, header


async def test_ready_works_and_uses_the_database(client: AsyncClient) -> None:
    response = await client.get("/ready")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ready"


async def test_ready_returns_503_when_the_db_dependency_fails(client: AsyncClient) -> None:
    async def broken() -> None:
        raise RuntimeError("database down")

    app.dependency_overrides[get_session] = broken
    try:
        response = await client.get("/ready")
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Database unavailable"


async def test_request_id_is_echoed_in_the_response(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert response.headers["X-Request-ID"] == "abc-123"


async def test_hsts_is_not_sent_over_plain_http(client: AsyncClient) -> None:
    """Sending it over http is meaningless, and on a shared development host it
    pins a browser to https for an origin that does not serve it."""
    response = await client.get("/health")

    assert "strict-transport-security" not in {k.lower() for k in response.headers}


async def test_hsts_is_sent_when_a_proxy_reports_tls(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Forwarded-Proto": "https"})

    assert "max-age=" in response.headers.get("Strict-Transport-Security", "")


async def test_an_oversized_body_is_refused(auth_client: AsyncClient) -> None:
    """Unbounded before this: a 5MB body was buffered and parsed happily."""
    limit = get_settings().max_request_bytes
    categories = (await auth_client.get("/api/v1/categories")).json()

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "oversized",
            "category_id": categories[0]["id"],
            "rating": 4,
            "serving_size": "medium",
            "padding": "A" * (limit + 1024),
        },
    )

    assert response.status_code == 413, response.text


async def test_a_normal_body_is_unaffected(auth_client: AsyncClient) -> None:
    categories = (await auth_client.get("/api/v1/categories")).json()

    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "ordinary",
            "category_id": categories[0]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )

    assert response.status_code == 201, response.text


def burst_size(limit: int) -> int:
    """How many attempts it takes to be certain of a 429.

    A fixed window resets on a boundary, and the module being tested says so:
    the worst case is a caller spending two windows' worth across one. A burst
    of limit + 3 therefore proves nothing, because a boundary landing in the
    middle can split it into two halves that each stay under the limit, and the
    test fails for a reason that has nothing to do with the limiter being wrong.
    Past 2 * limit no split can hide it.
    """
    return limit * 2 + 1


async def test_repeated_failed_logins_are_eventually_refused(client: AsyncClient) -> None:
    """A password list used to be limited only by how fast Argon2 runs."""
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "brute@forkast.app",
            "password": "password123",
        },
    )

    limit = get_settings().login_rate_limit
    statuses = [
        (
            await client.post(LOGIN, json={"email": "brute@forkast.app", "password": f"wrong{i}"})
        ).status_code
        for i in range(burst_size(limit))
    ]

    assert 429 in statuses, f"no attempt was ever throttled: {statuses}"
    assert statuses[0] == 401, "the first attempt must still be answered normally"


async def test_a_throttled_response_says_how_long_to_wait(client: AsyncClient) -> None:
    limit = get_settings().login_rate_limit
    last = None
    for i in range(burst_size(limit)):
        last = await client.post(
            LOGIN, json={"email": "retry@forkast.app", "password": f"wrong{i}"}
        )
        if last.status_code == 429:
            break

    assert last is not None and last.status_code == 429
    assert int(last.headers["Retry-After"]) > 0


async def test_throttling_one_account_does_not_lock_another(client: AsyncClient) -> None:
    """The limit is keyed on the subject as well as the peer, so one attacker
    cannot lock out every address they happen to know."""
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "target@forkast.app",
            "password": "password123",
        },
    )
    await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "other@forkast.app",
            "password": "password123",
        },
    )

    # burst_size rather than a few over the limit: if a window boundary split
    # this, the target would never actually be throttled and the test would pass
    # while proving nothing, which is worse than failing.
    for i in range(burst_size(get_settings().login_rate_limit)):
        await client.post(LOGIN, json={"email": "target@forkast.app", "password": f"no{i}"})

    unrelated = await client.post(
        LOGIN, json={"email": "other@forkast.app", "password": "password123"}
    )

    assert unrelated.status_code == 200, unrelated.text


@pytest.mark.timeout(180)
async def test_registration_is_throttled_too(client: AsyncClient) -> None:
    """Register answers 409 for an address that exists, which is an account
    existence oracle. It cannot be removed without an email round trip, so the
    limit is what stops it being run against a list.

    Marked with a longer timeout than the suite default: register_rate_limit
    is 120 in production, so burst_size (limit*2+1, chosen to survive a window
    boundary split) means 241 real sequential registrations here, each a real
    Argon2 hash plus a DB insert and commit. That routinely runs past the
    60s default, and pytest-timeout's thread method (the only one available on
    Windows, which has no SIGALRM) can't actually kill a thread stuck mid-await
    -- it can only dump the stack -- so hitting the default timeout hangs the
    whole run instead of just failing this one test.
    """
    # A different address every time, which is exactly what enumeration does
    # and exactly what a per-address key would fail to catch.
    statuses = [
        (
            await client.post(
                REGISTER,
                json={
                    "first_name": "Test",
                    "last_name": "User",
                    "email": f"probe{i}@forkast.app",
                    "password": "password123",
                },
            )
        ).status_code
        for i in range(burst_size(get_settings().register_rate_limit))
    ]

    assert 429 in statuses, f"registration was never throttled: {statuses}"


async def test_x_forwarded_for_cannot_be_used_to_reset_the_limit(client: AsyncClient) -> None:
    """Believing the header without a proxy in front lets any caller hand
    themselves a fresh identity on every request, which turns the limit off."""
    assert get_settings().trust_proxy_headers is False

    statuses = []
    for i in range(burst_size(get_settings().login_rate_limit)):
        statuses.append(
            (
                await client.post(
                    LOGIN,
                    json={"email": "spoof@forkast.app", "password": f"wrong{i}"},
                    headers={"X-Forwarded-For": f"10.0.0.{i}"},
                )
            ).status_code
        )

    assert 429 in statuses, f"a spoofed peer address defeated the limit: {statuses}"


def test_production_requires_an_explicit_trust_proxy_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    """Production must explicitly opt into trusting a proxy, or the app can
    never safely identify a shared NAT or CGNAT peer."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/forkast")
    monkeypatch.setenv(
        "TEST_DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/forkast_test"
    )
    monkeypatch.setenv("JWT_SECRET", "a-very-long-secret-that-is-matching-the-required-minimum")

    with pytest.raises(ValueError, match="TRUST_PROXY_HEADERS"):
        Settings()


async def test_refresh_allows_more_than_the_login_peer_window(client: AsyncClient) -> None:
    """Refresh calls are a different bucket from login attempts, because a CGNAT
    or a corporate proxy can share one peer across many users."""
    tokens = []
    for i in range(60):
        user = (
            await client.post(
                REGISTER,
                json={
                    "first_name": "Refresh",
                    "last_name": "User",
                    "email": f"refresh-{i}@forkast.app",
                    "password": "password123",
                },
            )
        ).json()
        tokens.append(user["refresh_token"])

    statuses = [
        (await client.post(REFRESH, json={"refresh_token": token})).status_code for token in tokens
    ]

    assert 429 not in statuses, statuses


async def test_signing_out_stops_the_access_token_immediately(client: AsyncClient) -> None:
    """Logout used to revoke only the refresh token, leaving the access token
    working for up to ACCESS_TOKEN_EXPIRE_MINUTES after the user asked to stop."""
    tokens = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "signout@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    assert (await client.get("/api/v1/me", headers=headers)).status_code == 200

    assert (
        await client.post(LOGOUT, json={"refresh_token": tokens["refresh_token"]})
    ).status_code == 204

    assert (await client.get("/api/v1/me", headers=headers)).status_code == 401


async def test_an_access_token_survives_its_own_session_rotating(client: AsyncClient) -> None:
    """Refreshing continues the session rather than starting a new one, so a
    client that refreshes in the background does not invalidate the token the
    request in flight beside it is using."""
    tokens = (
        await client.post(
            REGISTER,
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "rotate-sid@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    original = {"Authorization": f"Bearer {tokens['access_token']}"}

    rotated = (await client.post(REFRESH, json={"refresh_token": tokens["refresh_token"]})).json()

    assert (await client.get("/api/v1/me", headers=original)).status_code == 200
    assert (
        await client.get(
            "/api/v1/me", headers={"Authorization": f"Bearer {rotated['access_token']}"}
        )
    ).status_code == 200


async def test_an_access_token_from_another_session_is_unaffected_by_this_logout(
    client: AsyncClient,
) -> None:
    """Signing out on one device must not sign the user out everywhere."""
    # Carries the names because register requires them. LoginRequest ignores
    # the two extra keys, which is what lets one dict serve both calls.
    creds = {
        "first_name": "Test",
        "last_name": "User",
        "email": "twodevices@forkast.app",
        "password": "password123",
    }
    phone = (await client.post(REGISTER, json=creds)).json()
    laptop = (await client.post(LOGIN, json=creds)).json()

    await client.post(LOGOUT, json={"refresh_token": phone["refresh_token"]})

    assert (
        await client.get("/api/v1/me", headers={"Authorization": f"Bearer {phone['access_token']}"})
    ).status_code == 401
    assert (
        await client.get(
            "/api/v1/me", headers={"Authorization": f"Bearer {laptop['access_token']}"}
        )
    ).status_code == 200


async def test_a_token_with_no_session_claim_is_rejected(client: AsyncClient) -> None:
    """Tokens minted before sessions existed carry no `sid`. Accepting them
    would leave exactly the hole the claim closes."""
    import datetime as dt
    import uuid

    import jwt

    settings = get_settings()
    legacy = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "type": "access",
            "exp": int((dt.datetime.now(dt.UTC) + dt.timedelta(minutes=5)).timestamp()),
        },
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )

    response = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {legacy}"})

    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
async def test_the_docs_are_served_in_development(client: AsyncClient, path: str) -> None:
    """They are genuinely useful on a laptop; ENVIRONMENT=production is what
    turns them off, and the tests run as development."""
    assert get_settings().docs_enabled is True
    assert (await client.get(path)).status_code == 200
