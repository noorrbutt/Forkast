"""Durable background work: one row per thing that has to happen later.

In PostgreSQL rather than a broker for the same reason the rate limits are: it
is the one piece of infrastructure the app already has, and it means a job is
inserted in the same transaction as whatever made it necessary. A meal that
commits always has its refinement queued, and a meal that rolls back never
does, which no "fire something after the response" mechanism can promise.

Claimed with SELECT ... FOR UPDATE SKIP LOCKED; see services/jobs.py.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import DateTime, Index, Integer, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_uuid7, str_enum
from app.models.enums import JobStatus


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    status: Mapped[JobStatus] = mapped_column(
        str_enum(JobStatus, "job_status", length=16),
        nullable=False,
        default=JobStatus.pending,
        server_default=JobStatus.pending.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False)
    run_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    locked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # The claim query: due pending rows, oldest first. Partial, so done
        # rows piling up never make it slower.
        Index(
            "ix_jobs_pending_run_at",
            "run_at",
            postgresql_where=text("status = 'pending'"),
        ),
        # The sweep that requeues rows a crashed worker left running.
        Index(
            "ix_jobs_running_locked_at",
            "locked_at",
            postgresql_where=text("status = 'running'"),
        ),
    )
