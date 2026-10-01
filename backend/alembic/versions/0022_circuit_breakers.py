"""add circuit_breakers, the shared state of the breaker around Groq

Revision ID: 0022_circuit_breakers
Revises: 0021_jobs
Create Date: 2026-10-01

One row per breaker, shared by every API process and worker. See
app/models/circuit_breaker.py and app/services/circuit_breaker.py.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_circuit_breakers"
down_revision: str | Sequence[str] | None = "0021_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "circuit_breakers",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("probe_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("name", name=op.f("pk_circuit_breakers")),
    )


def downgrade() -> None:
    op.drop_table("circuit_breakers")
