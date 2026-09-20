"""add estimate_refined_at to food_logs

Revision ID: 0013_add_estimate_refined_at
Revises: 0012_refresh_token_live_session_index
Create Date: 2026-09-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0013_add_estimate_refined_at"
down_revision = "0012_refresh_token_live_session_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "food_logs",
        sa.Column("estimate_refined_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("food_logs", "estimate_refined_at")
