"""Async engine, session factory, and the FastAPI session dependency."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

_settings = get_settings()

# No Windows event-loop boilerplate here on purpose: asyncpg works on the
# default ProactorEventLoop, and asyncio.set_event_loop_policy is deprecated on
# Python 3.14 (removal in 3.16) and inert under uvicorn, which passes an
# explicit loop_factory since 0.36.0.
engine = create_async_engine(
    _settings.database_url,
    echo=False,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """The session factory itself, for work that needs its own transaction.

    The rate limiter is the only caller. It cannot share the request's session:
    a rejected login raises, `get_session` rolls back, and the attempt that was
    just counted would be rolled back with it -- leaving a limiter that only
    counts the attempts that succeeded, which is exactly backwards.

    It exists as a dependency rather than as a direct `SessionLocal` import so
    tests can point it at the test database along with everything else.
    """
    return SessionLocal


async def get_session() -> AsyncIterator[AsyncSession]:
    """Provide a session. Writing routes commit explicitly before returning.

    Deliberately does NOT commit after the yield. FastAPI runs the exit half of
    a yield dependency AFTER the response has been sent, so committing here
    hands the client its data before that data is durable. A quick client can
    then use a token from a register response and get a 401 because the row is
    not visible yet. Committing inside the handler removes the race entirely.
    """
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
