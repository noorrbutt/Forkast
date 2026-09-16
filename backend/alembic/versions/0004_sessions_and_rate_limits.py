"""bind access tokens to a session, and add the rate limit counters

Revision ID: 0004_sessions_and_rate_limits
Revises: 0003_enum_checks
Create Date: 2026-09-16

Two changes that both came out of the same pentest pass.

`refresh_tokens.session_id` is what makes logout actually log out. An access
token used to be a bearer credential nothing could withdraw, so signing out
revoked the refresh token and left the access token working until it expired.
Access tokens now name a session in a `sid` claim, every refresh token a
session rotates through carries the same session_id, and ending the session
ends both halves at once.

Existing rows are backfilled with their own id, so every token issued before
this migration becomes its own single-token session. Those access tokens carry
no `sid` and are rejected, which is the correct outcome: they predate the check
and honouring them would leave exactly the hole this closes. In practice
everyone signs in again once.

`rate_limit_counters` backs the limit on the unauthenticated auth routes and on
plan generation. It lives in PostgreSQL rather than process memory because
uvicorn runs several workers and a per-process dict silently multiplies the
configured limit by the worker count.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_sessions_and_rate_limits"
down_revision: str | Sequence[str] | None = "0003_enum_checks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Added nullable, backfilled, then constrained. Adding it NOT NULL outright
    # would fail on any database that already has tokens in it.
    op.add_column("refresh_tokens", sa.Column("session_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE refresh_tokens SET session_id = id WHERE session_id IS NULL")
    op.alter_column("refresh_tokens", "session_id", nullable=False)

    # Checked on every authenticated request, so it is the hottest lookup in
    # the schema and is not left to a sequential scan.
    op.create_index("ix_refresh_tokens_session_id", "refresh_tokens", ["session_id"], unique=False)

    op.create_table(
        "rate_limit_counters",
        # The composite primary key is the mechanism, not just an identifier:
        # it is what lets INSERT ... ON CONFLICT DO UPDATE be an atomic
        # increment, so two requests arriving together cannot both read the
        # same count and both be allowed through.
        sa.Column("bucket", sa.String(length=32), nullable=False),
        sa.Column("identity", sa.String(length=200), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint(
            "bucket", "identity", "window_start", name=op.f("pk_rate_limit_counters")
        ),
    )
    # Supports the prune that drops closed windows, the only query here that is
    # not a primary key lookup.
    op.create_index(
        "ix_rate_limit_counters_window_start", "rate_limit_counters", ["window_start"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_rate_limit_counters_window_start", table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")

    op.drop_index("ix_refresh_tokens_session_id", table_name="refresh_tokens")
    op.drop_column("refresh_tokens", "session_id")
