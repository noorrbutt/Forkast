"""Alembic environment.

Runs migrations asynchronously over asyncpg, matching the application. On
Windows this works because asyncpg is happy on the default ProactorEventLoop
that bare `asyncio.run` hands us here; psycopg3's async mode would not be, which
is one of the reasons the project uses asyncpg.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# The URL is injected here rather than through config.set_main_option, because
# that routes the value through ConfigParser, where a literal % in a password
# would be read as interpolation and blow up.
_settings = get_settings()
_DB_URL = _settings.database_url


# Indexes built from a SQL expression rather than a plain column. PostgreSQL
# reflects lower(email) back as lower((email)::text), and Alembic's cast
# stripping still leaves a form that never equals what the metadata compiled, so
# left visible autogenerate would propose dropping and recreating them on every
# run and `alembic check` would never be clean. They are created explicitly in
# the initial migration instead.
#
# Two kinds are deliberately NOT in this set, because excluding a comparable
# index silently removes it from drift detection, which is a cost with no
# benefit:
#  - the (user_id, created_at DESC) indexes. A DESC modifier on a plain column
#    is reflected as column_sorting, and Alembic's PostgreSQL implementation
#    normalises both sides to the same text, so they compare equal.
#  - the trigram indexes, which use postgresql_ops on a plain column.
EXPRESSION_INDEXES = {
    "uq_users_email_lower",
    "uq_restaurants_name_area_lower",
}


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    if type_ == "index" and name in EXPRESSION_INDEXES:
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=_DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        {"sqlalchemy.url": _DB_URL},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        server_version = await connection.scalar(text("SHOW server_version_num"))
        if server_version is None or int(server_version) < 180000:
            raise RuntimeError("Postgres 18 required (uuidv7)")
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
