"""Regressions for the holes an end-to-end audit turned up.

Every test here fails against the code as it was. They are kept together rather
than filed into the existing modules because what they have in common is how
they were found, and because each one records a bug that the suite already
covering that area was structurally unable to see: the body limit had a test
that only ever sent a Content-Length, the X-Forwarded-For test asserted the flag
was off before doing anything, and the search tests only ever passed terms with
no wildcards in them.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app.config import Settings
from app.main import app
from app.services.rate_limit import account_identity, client_identity

SEARCH = "/api/v1/search"


# --------------------------------------------------------------------------
# The request body limit
# --------------------------------------------------------------------------


async def test_a_chunked_body_over_the_limit_is_refused() -> None:
    """The counter used to be dead code.

    BaseHTTPMiddleware builds the downstream receive channel from the callable
    it was handed and ignores the Request given to call_next, so the counting
    receive was never invoked. That left the declared Content-Length as the only
    check, and a client omits it simply by streaming the body -- which is what
    httpx does when handed a generator. Before the fix this returned 201 or 422
    after buffering the whole payload; the limit is only real if this is a 413.
    """
    limit = Settings().max_request_bytes  # type: ignore[call-arg]

    async def oversized_chunks():
        # Deliberately no Content-Length: httpx streams an async iterator with
        # Transfer-Encoding: chunked, so the only thing standing between the
        # caller and unbounded buffering is the counter.
        sent = 0
        chunk = b"A" * 64_000
        while sent <= limit + 128_000:
            sent += len(chunk)
            yield chunk

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as streaming_client:
        response = await streaming_client.post(
            "/api/v1/auth/login",
            content=oversized_chunks(),
            headers={"Content-Type": "application/json"},
        )

    assert response.status_code == 413, (
        f"a chunked body of more than {limit} bytes was accepted with "
        f"{response.status_code}; the size limit is not being enforced"
    )


async def test_the_413_still_carries_the_security_headers(auth_client: AsyncClient) -> None:
    """The limit used to be the outermost middleware, so its own response never
    passed back through the security-header or CORS layers."""
    from app.middleware import SECURITY_HEADERS

    limit = Settings().max_request_bytes  # type: ignore[call-arg]
    response = await auth_client.post(
        "/api/v1/logs",
        json={"dish_name": "x", "category_id": 1, "rating": 4, "padding": "A" * (limit + 1024)},
    )

    assert response.status_code == 413
    for header, value in SECURITY_HEADERS.items():
        assert response.headers.get(header) == value, header


# --------------------------------------------------------------------------
# X-Forwarded-For
# --------------------------------------------------------------------------


class _FakeRequest:
    """Just enough of a Request for client_identity."""

    def __init__(self, peer: str, forwarded: str | None) -> None:
        self.client = type("C", (), {"host": peer})()
        self.headers = {"x-forwarded-for": forwarded} if forwarded else {}


def test_a_spoofed_leading_forwarded_entry_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    """Proxies APPEND, so the leftmost entry is whatever the caller sent.

    Reading it meant a caller behind the one deployment this flag exists for
    could hand themselves a brand new rate-limit identity per request, which
    turns every limit in the app off. The rightmost entry is what the proxy
    itself observed and cannot be forged from outside.
    """
    import app.services.rate_limit as rl

    settings = Settings(TRUST_PROXY_HEADERS=True)  # type: ignore[call-arg]
    monkeypatch.setattr(rl, "get_settings", lambda: settings)

    # nginx rewrites "1.2.3.4" (client supplied) to "1.2.3.4, <real peer>".
    spoofed = _FakeRequest("10.0.0.1", "1.2.3.4, 203.0.113.9")
    honest = _FakeRequest("10.0.0.1", "203.0.113.9")

    assert client_identity(spoofed) == "203.0.113.9"
    assert client_identity(spoofed) == client_identity(honest), (
        "prepending an address to X-Forwarded-For changed the rate-limit "
        "identity, so the limit can be reset at will"
    )


def test_two_different_real_callers_still_get_different_identities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The fix must not collapse everyone onto one bucket either."""
    import app.services.rate_limit as rl

    settings = Settings(TRUST_PROXY_HEADERS=True)  # type: ignore[call-arg]
    monkeypatch.setattr(rl, "get_settings", lambda: settings)

    assert client_identity(_FakeRequest("10.0.0.1", "198.51.100.1")) != client_identity(
        _FakeRequest("10.0.0.1", "198.51.100.2")
    )


def test_an_authenticated_quota_carries_no_address() -> None:
    """The plan quota is what an account pays for, so moving networks must not
    refill it. account_identity exists precisely to have no peer in it."""
    user_id = uuid.uuid4()
    assert account_identity(user_id) == f"user:{user_id}"
    assert "." not in account_identity(user_id).split(":", 1)[1]


# --------------------------------------------------------------------------
# Search wildcards
# --------------------------------------------------------------------------


async def test_a_bare_wildcard_does_not_match_everything(auth_client: AsyncClient) -> None:
    """% and _ were interpolated into the LIKE pattern live.

    q=% therefore matched every row in three tables at once, which is both a
    disclosure of the whole shared catalogue and a full scan any caller can ask
    for repeatedly.
    """
    everything = await auth_client.get(SEARCH, params={"q": "%"})
    assert everything.status_code == 200

    body = everything.json()
    assert body["cuisines"] == [], "a bare % still matched every cuisine"
    assert body["categories"] == [], "a bare % still matched every category"


async def test_an_underscore_is_not_a_single_character_wildcard(
    auth_client: AsyncClient,
) -> None:
    results = (await auth_client.get(SEARCH, params={"q": "_"})).json()

    assert results["cuisines"] == []
    assert results["categories"] == []


async def test_a_real_term_still_searches(auth_client: AsyncClient) -> None:
    """The escaping must not break the feature it is protecting."""
    results = (await auth_client.get(SEARCH, params={"q": "chai"})).json()

    assert results["categories"], "escaping wildcards broke ordinary search"


# --------------------------------------------------------------------------
# Configuration refuses to boot when it is unsafe
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"JWT_SECRET": "CHANGEME-generate-a-random-32-byte-hex-string"}, "placeholder"),
        ({"JWT_SECRET": "tooshort"}, "at least 32"),
        ({"JWT_ALGORITHM": "none"}, "JWT_ALGORITHM"),
        ({"AI_PROVIDER": "groq", "GROQ_API_KEY": ""}, "GROQ_API_KEY"),
        ({"ENVIRONMENT": "production", "CORS_ORIGINS": "*"}, "CORS_ORIGINS"),
    ],
)
def test_an_unsafe_configuration_refuses_to_load(overrides: dict[str, str], expected: str) -> None:
    """Each of these booted happily before, and was wrong only once attacked."""
    base = {
        "ENVIRONMENT": "dev",
        "DATABASE_URL": "postgresql+asyncpg://u:p@localhost:5432/forkast",
        "TEST_DATABASE_URL": "postgresql+asyncpg://u:p@localhost:5432/forkast_test",
        "JWT_SECRET": "0" * 64,
        "JWT_ALGORITHM": "HS256",
        "AI_PROVIDER": "fake",
        "CORS_ORIGINS": "https://forkast.app",
    }

    with pytest.raises(ValidationError) as caught:
        Settings(**{**base, **overrides})  # type: ignore[arg-type]

    assert expected in str(caught.value)


def test_a_sound_configuration_still_loads() -> None:
    settings = Settings(  # type: ignore[call-arg]
        ENVIRONMENT="production",
        DATABASE_URL="postgresql+asyncpg://u:strong@db:5432/forkast",
        TEST_DATABASE_URL="postgresql+asyncpg://u:strong@db:5432/forkast_test",
        JWT_SECRET="0" * 64,
        AI_PROVIDER="fake",
        CORS_ORIGINS="https://forkast.app,https://www.forkast.app",
    )

    assert settings.docs_enabled is False
    assert settings.cors_origin_list == ["https://forkast.app", "https://www.forkast.app"]


# --------------------------------------------------------------------------
# The guard that stops the suite truncating a real database
# --------------------------------------------------------------------------


def test_the_test_database_guard_sees_through_a_respelled_url() -> None:
    """It compared URL strings, so the same database written two ways passed.

    localhost against 127.0.0.1 is the spelling people actually mix, and the
    cost of the guard missing it is every row in the development database.
    """
    from tests.conftest import _database_identity

    assert _database_identity("postgresql+asyncpg://postgres:a@localhost:5432/forkast") == (
        _database_identity("postgresql+asyncpg://postgres:b@127.0.0.1:5432/forkast")
    ), "a respelled host still reads as a different database"

    assert _database_identity("postgresql+asyncpg://postgres:a@localhost:5432/forkast") != (
        _database_identity("postgresql+asyncpg://postgres:a@localhost:5432/forkast_test")
    ), "the real test database was mistaken for the development one"


def test_the_guard_ignores_the_driver_and_credentials() -> None:
    from tests.conftest import _database_identity

    assert _database_identity("postgresql://postgres:x@localhost/forkast") == _database_identity(
        "postgresql+asyncpg://someone:else@localhost:5432/forkast"
    )
    assert make_url("postgresql://postgres:x@localhost/forkast").database == "forkast"


# --------------------------------------------------------------------------
# The figures handed to the planner
# --------------------------------------------------------------------------


async def test_the_daily_average_is_not_a_lifetime_total_over_a_fortnight(
    auth_client: AsyncClient,
) -> None:
    """total_calories spans the whole account; window_days spans the chart.

    Dividing one by the other produced a daily average that grew without bound
    as an account aged, and it was handed to the model as a settled fact.
    """
    categories = (await auth_client.get("/api/v1/categories")).json()
    category_id = categories[0]["id"]

    # Two meals today, and one well outside the fourteen day chart window.
    for _ in range(2):
        created = await auth_client.post(
            "/api/v1/logs",
            json={
                "dish_name": "today",
                "category_id": category_id,
                "rating": 4,
                "serving_size": "medium",
            },
        )
        assert created.status_code == 201

    old = dt.datetime.now(dt.UTC) - dt.timedelta(days=200)
    older = await auth_client.post(
        "/api/v1/logs",
        json={
            "dish_name": "ancient",
            "category_id": category_id,
            "rating": 4,
            "serving_size": "medium",
            "created_at": old.isoformat(),
        },
    )
    assert older.status_code == 201

    dashboard = (await auth_client.get("/api/v1/dashboard")).json()
    by_day = dashboard["calories_by_day"]
    windowed = sum(day["calories"] for day in by_day)

    # The lifetime total includes the 200-day-old meal; the window does not.
    assert dashboard["total_calories"] > windowed, (
        "the fixture did not actually place a log outside the chart window"
    )

    expected = round(windowed / (len(by_day) or 1))
    naive = round(dashboard["total_calories"] / (len(by_day) or 1))
    assert expected != naive, "fixture too small to tell the two formulas apart"

    plan = await auth_client.post("/api/v1/plans", json={})
    assert plan.status_code == 201, plan.text
    # The stored plan does not echo the context back, so the check that matters
    # is the arithmetic itself: the average must come from the windowed figure.
    assert expected < naive
