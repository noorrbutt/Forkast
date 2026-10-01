"""A circuit breaker around the calorie model, shared through PostgreSQL.

Closed: calls go through, and consecutive failures are counted. A success
resets the count.

Open: after ai_breaker_threshold consecutive failures. No call is made; the
refinement keeps the provisional category figure the log was saved with, and
new saves do not queue a refinement at all, so an outage does not fill the
jobs table with work that can only fail. refine-backfill picks those logs up
once the provider is back.

Half-open: once it has been open for ai_breaker_cooldown_seconds, exactly one
caller is let through as a probe, claimed atomically so two processes cannot
both probe. Its success closes the breaker; its failure reopens it and starts
the cooldown again. A probe whose caller died is given up on after another
cooldown, so the breaker cannot wedge half-open forever.

The state lives in one row per breaker rather than in process memory, for the
reason rate limits do: the API runs as several processes and the worker as
more, and every one of them would otherwise have to see the outage for itself.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings

GROQ = "groq"


def _cooldown() -> float:
    return get_settings().ai_breaker_cooldown_seconds


async def is_open(session: AsyncSession, name: str = GROQ) -> bool:
    """Open and still cooling down. Half-open counts as not open: the probe
    needs something to run on, so enqueueing resumes once the cooldown ends."""
    return bool(
        await session.scalar(
            text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM circuit_breakers
                    WHERE name = :name
                      AND opened_at IS NOT NULL
                      AND opened_at > now() - make_interval(secs => :cooldown)
                )
                """
            ),
            {"name": name, "cooldown": _cooldown()},
        )
    )


async def allow(factory: async_sessionmaker[AsyncSession], name: str = GROQ) -> bool:
    """Whether a call may go out now. True for the one half-open probe."""
    async with factory() as session:
        probe = await session.scalar(
            text(
                """
                UPDATE circuit_breakers
                SET probe_started_at = now()
                WHERE name = :name
                  AND opened_at IS NOT NULL
                  AND opened_at <= now() - make_interval(secs => :cooldown)
                  AND (probe_started_at IS NULL
                       OR probe_started_at <= now() - make_interval(secs => :cooldown))
                RETURNING name
                """
            ),
            {"name": name, "cooldown": _cooldown()},
        )
        await session.commit()
        if probe is not None:
            return True
        opened_at = await session.scalar(
            text("SELECT opened_at FROM circuit_breakers WHERE name = :name"), {"name": name}
        )
        return opened_at is None


async def record_success(factory: async_sessionmaker[AsyncSession], name: str = GROQ) -> None:
    async with factory() as session:
        await session.execute(
            text(
                """
                UPDATE circuit_breakers
                SET failures = 0, opened_at = NULL, probe_started_at = NULL
                WHERE name = :name AND (failures <> 0 OR opened_at IS NOT NULL)
                """
            ),
            {"name": name},
        )
        await session.commit()


async def record_failure(factory: async_sessionmaker[AsyncSession], name: str = GROQ) -> None:
    """Count a failure, opening the breaker at the threshold. A failure while
    already open (the half-open probe) reopens it, restarting the cooldown."""
    async with factory() as session:
        await session.execute(
            text(
                """
                INSERT INTO circuit_breakers AS b (name, failures, opened_at)
                VALUES (:name, 1, CASE WHEN 1 >= :threshold THEN now() END)
                ON CONFLICT (name) DO UPDATE SET
                    failures = b.failures + 1,
                    opened_at = CASE
                        WHEN b.opened_at IS NOT NULL OR b.failures + 1 >= :threshold
                        THEN now()
                    END,
                    probe_started_at = NULL
                """
            ),
            {"name": name, "threshold": get_settings().ai_breaker_threshold},
        )
        await session.commit()
