"""Shared state for the circuit breaker around the AI provider.

In PostgreSQL for the same reason as the rate limit counters: the API runs as
several processes and the worker as more, and a breaker each of them keeps
in memory would have to see the outage separately, N times over, before any
of them stopped calling. One row per breaker; see services/circuit_breaker.py.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CircuitBreaker(Base):
    __tablename__ = "circuit_breakers"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    # Consecutive failures; any success puts it back to zero.
    failures: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Set while open. Once it is cooldown old the breaker is half-open.
    opened_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # When the one half-open probe was let through, so a second caller is not.
    probe_started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
