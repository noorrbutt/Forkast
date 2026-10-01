"""add the jobs table, a durable queue for work done behind the response

Revision ID: 0021_jobs
Revises: 0020_photo_macros_source
Create Date: 2026-10-01

Calorie refinement and the auth emails used to run as FastAPI BackgroundTasks,
which live only in the memory of the process that answered the request: a
restart or a crash between the response and the task lost the work silently,
and refine-backfill existed purely to sweep up after that. A row here is
inserted in the same transaction as the meal or the token that needs it, so it
survives anything the commit survives. See app/models/job.py.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021_jobs"
down_revision: str | Sequence[str] | None = "0020_photo_macros_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column(
            "run_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'done', 'dead_letter')",
            name=op.f("ck_jobs_job_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jobs")),
    )
    op.create_index(
        "ix_jobs_pending_run_at",
        "jobs",
        ["run_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_jobs_running_locked_at",
        "jobs",
        ["locked_at"],
        postgresql_where=sa.text("status = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_running_locked_at", table_name="jobs")
    op.drop_index("ix_jobs_pending_run_at", table_name="jobs")
    op.drop_table("jobs")
