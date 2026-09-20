"""add client_id to food_logs

Revision ID: 0014_food_logs_client_id
Revises: 0013_add_estimate_refined_at
Create Date: 2026-09-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_food_logs_client_id"
down_revision = "0013_add_estimate_refined_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("food_logs", sa.Column("client_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ux_food_logs_user_client_id",
        "food_logs",
        ["user_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_food_logs_user_client_id", table_name="food_logs")
    op.drop_column("food_logs", "client_id")
