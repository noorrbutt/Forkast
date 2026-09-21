"""Create a partial index for live refresh-token lookups.

Revision ID: 0012_refresh_live_session_idx
Revises: 0011_names_and_google_accounts
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_refresh_live_session_idx"
down_revision: str | Sequence[str] | None = "0011_names_and_google_accounts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_refresh_tokens_session_id", table_name="refresh_tokens")
    op.create_index(
        "ix_refresh_tokens_live_session",
        "refresh_tokens",
        ["session_id"],
        unique=False,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_live_session", table_name="refresh_tokens")
    op.create_index("ix_refresh_tokens_session_id", "refresh_tokens", ["session_id"])
