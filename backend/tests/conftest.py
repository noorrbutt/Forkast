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
from collections.abc import AsyncIterator, Iterator
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

# Must be set before the first call to get_settings() (below, and again on
# import of app.main), since Settings is built once and then @lru_cached.
#
# Two independent problems, one fix: a real Argon2 hash costs ~100ms, and this
# suite performs hundreds of them across the registration and brute-force
# burst tests -- easily minutes of wall clock at production cost. Worse,
# argon2-cffi's default parallelism (4) spins up its own worker threads per
# hash; done from inside an anyio worker thread that a request handler is
# already blocking on, that nested threading is what was hanging the suite on
# Windows (visible as a stuck native argon2_hash call in the pytest-timeout
# thread dump). time_cost=1, a small memory_cost, and parallelism=1 make every
# hash cheap and single-threaded without changing any application code path --
# the tests exercise the exact same hash-and-verify logic production does.
# setdefault, not assignment, so a developer can still override these from the
# environment (e.g. to reproduce a timing-sensitive bug at real cost).
os.environ.setdefault("ARGON2_TIME_COST", "1")
os.environ.setdefault("ARGON2_MEMORY_COST", "8192")
os.environ.setdefault("ARGON2_PARALLELISM", "1")
# The timing-equaliser pads every failed login to a fixed wall-clock cost
# regardless of how fast Argon2 itself runs, so the brute-force tests -- which
# fire off dozens of bad logins each -- pay this back to back. 250ms of real
# padding was fine for a handful of attempts; multiplied across four separate
# burst tests it was several extra seconds each. 30ms still keeps the
# unknown-email path in the same rough timing class as a fast test-mode verify.
os.environ.setdefault("LOGIN_TIMING_PAD_SECONDS", "0.03")

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
def migrated_database() -> Iterator[None]:
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

    # Drop the entire public schema, then rebuild it from the migration chain.
    # This avoids the stale-object and deadlock states that arise when a prior
    # run leaves half-finished tables behind, and it keeps the suite aligned
    # with the real migration history instead of whichever leftover rows the
    # previous test happened to leave behind.
    reset = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async def _reset_schema() -> None:
            async with reset.begin() as connection:
                await connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
                await connection.execute(text("CREATE SCHEMA public"))

        asyncio.run(_reset_schema())
    finally:
        asyncio.run(reset.dispose())

    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], **common)

    yield

    # _reset_app_db_pool() rebuilds app_db.engine before every test but only
    # disposes the *previous* one, so the last engine of the run is still
    # holding open connections when the process exits unless we close it here.
    import app.db as app_db

    if hasattr(app_db, "engine"):
        asyncio.run(app_db.engine.dispose())


async def _clear_stale_connections(engine) -> None:
    """Drop any test DB sessions left behind by a crashed pytest process.

    A timed-out or interrupted run can leave backends alive long enough to hold
    ACCESS EXCLUSIVE locks, which then makes the next run fail during the normal
    TRUNCATE cleanup before any test body runs. Terminating stale sessions is a
    test-only safety net and is safe because the database is dedicated to pytest.
    """
    async with engine.begin() as connection:
        await connection.execute(
            text(
                """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                """
            )
        )


async def _truncate_if_present() -> None:
    """Empty whichever mutable tables exist right now.

    Runs before the migrations, against whatever schema the previous session
    happened to leave behind, so it cannot assume the current table list. A
    table added by a later migration is simply absent here, and naming it in a
    TRUNCATE would fail the fixture and error every test in the suite.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        await _clear_stale_connections(engine)
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
                quoted = ", ".join(f'"{table_name}"' for table_name in present)
                await connection.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"))
    finally:
        await engine.dispose()


async def _reset_app_db_pool() -> None:
    """Drop stale asyncpg connections held by the app-wide engine.

    A prior failed test run can leave a connection alive in the connection pool,
    and that pool survives across test setup. Disposing the global engine makes
    the next request open a fresh connection set instead of reusing a dead one.
    """
    import app.db as app_db

    if hasattr(app_db, "engine"):
        await app_db.engine.dispose()
    if hasattr(app_db, "SessionLocal") and getattr(app_db.SessionLocal, "bind", None) is not None:
        await app_db.SessionLocal.bind.dispose()

    # Bounded and small on purpose. This engine is rebuilt before every test,
    # so the default pool (5 + 10 overflow) accumulates one full pool's worth
    # of idle connections per test that never got closed -- across a full
    # suite that is enough backends to make Postgres itself start queueing
    # new connect() calls, which surfaces as the whole run hanging with no
    # error. A couple of connections is all any single test needs.
    app_db.engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=2,
    )
    app_db.SessionLocal = async_sessionmaker(
        app_db.engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


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
    last: Exception | None = None
    for attempt in range(5):
        try:
            await _clear_stale_connections(test_engine)
            await _reset_app_db_pool()
            async with test_engine.begin() as connection:
                await connection.execute(text("SET LOCAL lock_timeout = '2s'"))
                present = (
                    await connection.execute(
                        text(
                            """
                            SELECT table_name FROM information_schema.tables
                            WHERE table_schema = 'public' AND table_name = ANY(:names)
                            """
                        ),
                        {"names": list(MUTABLE_TABLES)},
                    )
                ).all()
                present_names = [row[0] for row in present]
                if present_names:
                    quoted = ", ".join(f'"{table_name}"' for table_name in present_names)
                    await connection.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"))
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
                try:
                    await db.rollback()
                except Exception:
                    pass
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
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": fixture_email,
            "password": FIXTURE_PASSWORD,
        },
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