"""Fixed-window rate limiting, counted in PostgreSQL.

Fixed windows rather than a sliding log or a token bucket: the worst case of a
fixed window is that a caller spends two windows' worth of attempts across a
boundary, so "ten guesses per five minutes" is really twenty in the worst case.
That is still a useless rate for guessing a password, and it buys an increment
that is one statement and needs no per-request state.

The increment is a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so
concurrent requests serialise on the row instead of racing a read-then-write.
Two attempts arriving together cannot both see "9 so far" and both be allowed.

Counts are stored rather than kept in a dict because uvicorn is normally run
with several workers, and a per-process dict silently multiplies the real limit
by the worker count -- and resets on every deploy.
"""

from __future__ import annotations

import datetime as dt
import hashlib

from fastapi import HTTPException, Request, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import RateLimitCounter

# Identities longer than the column are hashed rather than truncated, so two
# long addresses sharing a prefix do not end up sharing an allowance.
_MAX_IDENTITY = 200

# Counters older than this are dropped. Comfortably longer than the longest
# window so a prune can never delete a window that is still being counted.
_PRUNE_AFTER_SECONDS = 86_400


def _window_start(now: dt.datetime, window_seconds: int) -> dt.datetime:
    """Floor `now` to the start of its window, so everyone in the same window
    increments one row rather than creating a row each."""
    epoch_seconds = int(now.timestamp())
    return dt.datetime.fromtimestamp(epoch_seconds - (epoch_seconds % window_seconds), tz=dt.UTC)


def client_identity(request: Request, *, subject: str | None = None) -> str:
    """Who the attempt is counted against.

    Both the peer address and the subject, because each alone has a hole. Keyed
    only on the subject, one attacker can lock every account whose address they
    know by burning its allowance. Keyed only on the address, a botnet spreads
    guesses across hosts and never trips anything.

    X-Forwarded-For is consulted only when the deployment says it sits behind a
    proxy. Trusting it unconditionally lets any caller choose their own identity
    per request, which turns the limiter off entirely.
    """
    peer = request.client.host if request.client else "unknown"
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded.strip():
            peer = forwarded.split(",")[0].strip() or peer

    identity = f"{peer}|{subject.strip().lower()}" if subject else peer
    if len(identity) > _MAX_IDENTITY:
        identity = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return identity


class RateLimiter:
    """Counts attempts on its own connection, separate from the request's."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def hit(self, bucket: str, identity: str, *, limit: int, window_seconds: int) -> None:
        """Count one attempt, and raise 429 once the window's allowance is spent.

        The increment happens before the check, so attempts made while already
        blocked still count and do not extend the window either way -- it always
        expires on schedule.
        """
        now = dt.datetime.now(dt.UTC)
        window_start = _window_start(now, window_seconds)

        async with self._session_factory() as session:
            count = await session.scalar(
                insert(RateLimitCounter)
                .values(bucket=bucket, identity=identity, window_start=window_start, count=1)
                .on_conflict_do_update(
                    index_elements=["bucket", "identity", "window_start"],
                    set_={"count": RateLimitCounter.count + 1},
                )
                .returning(RateLimitCounter.count)
            )
            await session.commit()

        if count is not None and count > limit:
            closes_at = window_start + dt.timedelta(seconds=window_seconds)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Try again shortly.",
                # Tells an honest client exactly how long to wait, and tells an
                # attacker only what they could have measured anyway.
                headers={"Retry-After": str(max(int((closes_at - now).total_seconds()), 1))},
            )

    async def prune(self) -> int:
        """Drop counters whose window closed long ago.

        Called from the auth routes rather than from a scheduled job: the table
        only grows while someone is failing to authenticate, so the cheapest
        place to clean it is the path that fills it, and there is no cron entry
        to forget to install.
        """
        cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=_PRUNE_AFTER_SECONDS)
        async with self._session_factory() as session:
            result = await session.execute(
                delete(RateLimitCounter).where(RateLimitCounter.window_start < cutoff)
            )
            await session.commit()
            return result.rowcount or 0
