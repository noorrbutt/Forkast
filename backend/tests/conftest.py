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
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402
from app.db import get_session  # noqa: E402
from app.main import app  # noqa: E402

TEST_DATABASE_URL = get_settings().test_database_url

# Everything a test can create. Reference tables are excluded on purpose.
MUTABLE_TABLES = ("food_logs", "ai_plans", "refresh_tokens", "restaurants", "users")


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
    """Empty the mutable tables, tolerating a database with no schema at all."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    f"""
                    DO $$
                    BEGIN
                        IF to_regclass('public.{MUTABLE_TABLES[0]}') IS NOT NULL THEN
                            TRUNCATE {", ".join(MUTABLE_TABLES)} CASCADE;
                        END IF;
                    END $$;
                    """
                )
            )
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
    """Empty the mutable tables before each test."""
    async with test_engine.begin() as connection:
        await connection.execute(
            text(f"TRUNCATE {', '.join(MUTABLE_TABLES)} RESTART IDENTITY CASCADE")
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
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as http:
            yield http
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
async def auth_client(client: AsyncClient) -> AsyncClient:
    """A client registered and authenticated through the real endpoints.

    Going through the API rather than injecting a user keeps every object
    attached to the request's own session, and means the auth path is exercised
    by every test rather than only by test_auth.
    """
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "fixture@forkast.app", "password": "password123"},
    )
    assert response.status_code == 201, response.text
    tokens = response.json()
    client.headers["Authorization"] = f"Bearer {tokens['access_token']}"
    return client
