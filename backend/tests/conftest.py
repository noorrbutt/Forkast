"""Test harness.

There is no Docker on this machine, so tests run against a real local
`forkast_test` database. The schema is built once per session by running the
actual migrations, which means every run also re-proves that
`alembic upgrade head` works against an empty database.

Isolation is by truncation rather than by wrapping each test in a transaction.
The transaction approach needs the test and the application to share one
connection, and sharing a single asyncpg connection across the test body and an
in-flight ASGI request produces "another operation is in progress" as soon as a
test does more than one thing. Truncating the mutable tables between tests is
less clever and considerably more predictable.

Engines are per test rather than per session for the same underlying reason:
asyncpg connections belong to the event loop that opened them.

Reference data (cuisines, food categories) is deliberately NOT truncated: it
comes from migration 0002 and the app cannot function without it.
"""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402
from app.db import get_session, get_session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.services.ai.deps import get_ai_service  # noqa: E402
from app.services.ai.fake import DeterministicAIService  # noqa: E402

TEST_DATABASE_URL = get_settings().test_database_url

# This suite truncates every mutable table, so it must never be pointed at a
# database anyone cares about. A single wrong line in .env would otherwise
# empty the development database silently, and the first sign of it would be a
# real account failing to log in. Refusing to collect is the cheapest possible
# place to catch that.
#
# Compared on the parts that decide which database is actually opened, not on
# the URL text. String equality passed happily when the same database was
# spelled two ways -- localhost against 127.0.0.1, a different password, a
# trailing slash, an added query parameter -- and every one of those spellings
# connects to the identical server and truncates the identical tables.


def _database_identity(url: str) -> tuple[str, int, str]:
    """Host, port and database name, normalised so two spellings of one
    database compare equal. Credentials and driver are deliberately ignored:
    changing either still lands on the same data."""
    parsed = make_url(url.strip())
    host = (parsed.host or "localhost").lower()
    # The loopback spellings are the ones that actually get typed differently.
    if host in {"127.0.0.1", "::1", "localhost"}:
        host = "localhost"
    return host, parsed.port or 5432, (parsed.database or "").strip("/")


if _database_identity(TEST_DATABASE_URL) == _database_identity(get_settings().database_url):
    raise RuntimeError(
        "TEST_DATABASE_URL and DATABASE_URL resolve to the same database "
        f"({_database_identity(TEST_DATABASE_URL)}). Running the suite would "
        "truncate the development data. Point TEST_DATABASE_URL at forkast_test."
    )

# Everything a test can create. Reference tables are excluded on purpose.
MUTABLE_TABLES = (
    "food_logs",
    "ai_plans",
    "refresh_tokens",
    "restaurants",
    "users",
    # Truncated like the rest, or one test's failed logins spend the next
    # test's allowance and the suite fails depending on ordering.
    "rate_limit_counters",
)


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Build the test schema by running the real migrations.

    Alembic runs as a subprocess with DATABASE_URL pointed at the test database.
    Environment variables take precedence over .env in pydantic-settings, so
    env.py picks up the override with no test-only branch in application code.
    """
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL}
    common = {"cwd": BACKEND_DIR, "env": env, "check": True, "capture_output": True, "text": True}

    # Rows left by the previous run have to go first. food_logs references
    # food_categories with ON DELETE RESTRICT, and migration 0002's downgrade
    # deletes the reference rows, so a single leftover log makes `downgrade
    # base` fail. That is correct behaviour in the migration and the wrong thing
    # to leave to chance here, since which test ran last decides whether the
    # next session can even start.
    asyncio.run(_truncate_if_present())

    # Start from a known state, so a half-migrated database left by an earlier
    # run cannot make these tests pass or fail for the wrong reason.
    subprocess.run([sys.executable, "-m", "alembic", "downgrade", "base"], **common)
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], **common)


async def _truncate_if_present() -> None:
    """Empty whichever mutable tables exist right now.

    Runs before the migrations, against whatever schema the previous session
    happened to leave behind, so it cannot assume the current table list. A
    table added by a later migration is simply absent here, and naming it in a
    TRUNCATE would fail the fixture and error every test in the suite.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            present = (
                await connection.scalars(
                    text(
                        """
                        SELECT table_name FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = ANY(:names)
                        """
                    ),
                    {"names": list(MUTABLE_TABLES)},
                )
            ).all()
            if present:
                await connection.execute(text(f"TRUNCATE {', '.join(present)} CASCADE"))
    finally:
        await engine.dispose()


@pytest.fixture
async def test_engine() -> AsyncIterator[object]:
    """A fresh engine per test, with pooling disabled.

    asyncpg connections are bound to the event loop that opened them, and
    pytest-asyncio gives each test its own loop. A session scoped engine would
    hand a later test a connection belonging to a dead loop, which surfaces as
    an opaque "another operation is in progress" InterfaceError. NullPool plus a
    per-test engine keeps every connection inside the loop that created it.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
def session_factory(test_engine):
    return async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def clean_tables(test_engine) -> AsyncIterator[None]:
    """Empty the mutable tables before each test.

    Retried, because TRUNCATE needs an ACCESS EXCLUSIVE lock on every table it
    names and the previous test may still have a writer holding a row lock on
    one of them. Creating a log schedules `_refine_estimate` as a background
    task, which opens its own session after the response has gone out, so a test
    that logs a meal can still be writing while the next test starts clearing up
    behind it. PostgreSQL spots the cycle and kills one side as a deadlock.

    This is what made four tests error at random before, with no relation to
    what any of them was asserting. lock_timeout turns the wait into a prompt,
    retryable failure rather than a deadlock, and the short sleep gives the
    straggler time to commit and let go.
    """
    statement = text(f"TRUNCATE {', '.join(MUTABLE_TABLES)} RESTART IDENTITY CASCADE")

    last: Exception | None = None
    for attempt in range(5):
        try:
            async with test_engine.begin() as connection:
                await connection.execute(text("SET LOCAL lock_timeout = '2s'"))
                await connection.execute(statement)
            break
        except DBAPIError as exc:  # deadlock, or the lock_timeout above expiring
            last = exc
            await asyncio.sleep(0.1 * (attempt + 1))
    else:
        raise AssertionError(
            "could not clear the test tables after 5 attempts; something is "
            f"still holding a lock on them: {last}"
        )
    yield


@pytest.fixture
async def session(session_factory) -> AsyncIterator[AsyncSession]:
    """A session for asserting directly against the database."""
    async with session_factory() as db:
        yield db


@pytest.fixture
async def client(session_factory) -> AsyncIterator[AsyncClient]:
    async def _override_session() -> AsyncIterator[AsyncSession]:
        # Mirrors app.db.get_session exactly, including the absence of a commit
        # after the yield. Committing here would hide the read-after-write race
        # that the real dependency used to have.
        async with session_factory() as db:
            try:
                yield db
            except Exception:
                await db.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session
    # The rate limiter deliberately opens its own transaction rather than
    # joining the request's, so it resolves the factory separately. Without
    # this override it would count attempts in the development database while
    # the rest of the test ran against the test one.
    app.dependency_overrides[get_session_factory] = lambda: session_factory
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as http:
            yield http
    finally:
        app.dependency_overrides.clear()


FIXTURE_PASSWORD = "password123"


@pytest.fixture
def fixture_email(request: pytest.FixtureRequest) -> str:
    """The address auth_client registers, distinct for every test.

    It used to be the single literal "fixture@forkast.app" for all of them,
    which coupled every test in the suite to every other one: a row that
    outlived the truncate between two tests turned the next registration into a
    409, and the test that then errored was never the test that caused it. That
    showed up as a handful of unrelated failures that moved around between runs
    and vanished when the file was run on its own.

    Derived from the test's own name, so a failure names the test that owns the
    data, and so the address is stable across runs of the same test.
    """
    local = re.sub(r"[^a-z0-9]+", "-", request.node.name.lower()).strip("-")[:50]
    return f"{local or 'fixture'}@forkast.app"


@pytest.fixture
async def auth_client(client: AsyncClient, fixture_email: str) -> AsyncClient:
    """A client registered and authenticated through the real endpoints.

    Going through the API rather than injecting a user keeps every object
    attached to the request's own session, and means the auth path is exercised
    by every test rather than only by test_auth.
    """
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": fixture_email, "password": FIXTURE_PASSWORD},
    )
    assert response.status_code == 201, response.text
    tokens = response.json()
    client.headers["Authorization"] = f"Bearer {tokens['access_token']}"
    return client


@pytest.fixture(autouse=True)
def deterministic_ai() -> AsyncIterator[None]:
    """Force the local estimator for every test, whatever .env says.

    Without this the suite resolves the provider from configuration, so setting
    AI_PROVIDER=groq for real use would silently point 160 tests at a paid API:
    slow, billable, flaky, and dependent on a network. A test that needs a
    different implementation overrides this one for its own duration.
    """
    app.dependency_overrides[get_ai_service] = DeterministicAIService
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_ai_service, None)
