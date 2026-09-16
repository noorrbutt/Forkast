"""Counters backing the auth and plan rate limits.

In PostgreSQL rather than process memory, for two reasons. uvicorn is normally
run with more than one worker, and an in-process dict gives each worker its own
allowance -- so the real limit is silently the configured one times the worker
count. And a counter that resets whenever the process restarts is a limit an
attacker can clear by waiting for a deploy.

One row per (bucket, identity, window). Old rows are pruned opportunistically by
the service rather than by a scheduled job, so there is nothing to forget to run.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import BigInteger, DateTime, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RateLimitCounter(Base):
    __tablename__ = "rate_limit_counters"

    # The composite primary key is the whole point: it is what makes
    # INSERT ... ON CONFLICT DO UPDATE an atomic increment, so two requests
    # arriving together cannot both read "9 attempts" and both be allowed.
    bucket: Mapped[str] = mapped_column(String(32), primary_key=True)
    identity: Mapped[str] = mapped_column(String(200), primary_key=True)
    window_start: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)

    count: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))

    __table_args__ = (
        # Supports the prune that deletes everything older than the current
        # window, which is the only query that is not a primary key lookup.
        Index("ix_rate_limit_counters_window_start", "window_start"),
    )
