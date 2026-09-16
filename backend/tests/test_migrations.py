"""Migration health.

These are the slow tests in the suite, and the ones most worth having: a
migration that cannot be reversed is only discovered at the worst possible
moment otherwise.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings

BACKEND_DIR = Path(__file__).resolve().parent.parent
TEST_DATABASE_URL = get_settings().test_database_url


def _alembic(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        capture_output=True,
        text=True,
        check=False,
    )


def test_models_and_migrations_have_not_drifted() -> None:
    """`alembic check` fails if a model changed without a migration."""
    result = _alembic("check")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "No new upgrade operations detected" in (result.stdout + result.stderr)


@pytest.mark.slow
async def test_migrations_round_trip_cleanly() -> None:
    """upgrade, downgrade to base, upgrade again.

    The downgrade half is what catches the classic PostgreSQL trap: dropping a
    table does not drop a native enum type, so a second upgrade fails with
    "type already exists". Storing the closed vocabularies as varchar plus check
    is precisely what makes this pass.
    """
    assert _alembic("downgrade", "base").returncode == 0

    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            leftover_types = await connection.scalar(
                text(
                    "SELECT count(*) FROM pg_type t "
                    "JOIN pg_namespace n ON n.oid = t.typnamespace "
                    "WHERE n.nspname = 'public' AND t.typtype = 'e'"
                )
            )
            leftover_tables = await connection.scalar(
                text(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name <> 'alembic_version'"
                )
            )
    finally:
        await engine.dispose()

    assert leftover_types == 0, "downgrade left orphaned enum types behind"
    assert leftover_tables == 0, "downgrade left tables behind"

    second = _alembic("upgrade", "head")
    assert second.returncode == 0, second.stdout + second.stderr


@pytest.mark.slow
async def test_reference_data_is_present_after_upgrade() -> None:
    """A fresh `upgrade head` must leave the app actually usable."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            cuisines = await connection.scalar(text("SELECT count(*) FROM cuisines"))
            categories = await connection.scalar(text("SELECT count(*) FROM food_categories"))
            orphans = await connection.scalar(
                text(
                    "SELECT count(*) FROM food_categories fc "
                    "LEFT JOIN cuisines c ON c.id = fc.cuisine_id WHERE c.id IS NULL"
                )
            )
            trgm = await connection.scalar(
                text("SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm'")
            )
    finally:
        await engine.dispose()

    assert cuisines >= 8
    assert categories >= 30
    assert orphans == 0
    assert trgm == 1


@pytest.mark.slow
async def test_closed_vocabularies_are_enforced_by_the_database() -> None:
    """The varchar plus CHECK promise has to be real, not just declared.

    This cannot be left to `alembic check`. Alembic autogenerate does not detect
    CHECK constraints at all, so when these were missing it still reported no
    drift. The only way to know is to ask the database.

    Pydantic already rejects a bad value at the API boundary. This guards the
    paths that do not go through it: a seed script, a bulk import, a direct SQL
    fix, or a bug in a later code path.
    """
    expected = {
        "ck_food_logs_serving_size",
        "ck_food_logs_friend_scale",
        "ck_users_goal",
        "ck_ai_plans_goal",
    }

    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            rows = await connection.scalars(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE contype = 'c' AND connamespace = 'public'::regnamespace"
                )
            )
            present = set(rows)

            native_enums = await connection.scalar(
                text(
                    "SELECT count(*) FROM pg_type t "
                    "JOIN pg_namespace n ON n.oid = t.typnamespace "
                    "WHERE n.nspname = 'public' AND t.typtype = 'e'"
                )
            )

            category_id = await connection.scalar(text("SELECT id FROM food_categories LIMIT 1"))
            await connection.execute(
                text(
                    "INSERT INTO users (email, password_hash) "
                    "VALUES ('vocab-probe@forkast.app', 'x')"
                )
            )
            user_id = await connection.scalar(
                text("SELECT id FROM users WHERE email = 'vocab-probe@forkast.app'")
            )

            rejected = False
            try:
                await connection.execute(
                    text(
                        "INSERT INTO food_logs "
                        "(user_id, dish_name, category_id, rating, serving_size, estimated_calories) "
                        "VALUES (:uid, 'probe', :cid, 3, 'gigantic', 100)"
                    ),
                    {"uid": user_id, "cid": category_id},
                )
            except IntegrityError:
                rejected = True
            await connection.rollback()
    finally:
        await engine.dispose()

    assert expected <= present, f"missing CHECK constraints: {sorted(expected - present)}"
    assert native_enums == 0, "a native PostgreSQL enum type was created, which breaks downgrades"
    assert rejected, "the database accepted an invalid serving_size"

