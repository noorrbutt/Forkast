"""add streak freezes

Revision ID: 0017_streak_freezes
Revises: 0016_password_reset_tokens
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_streak_freezes"
down_revision = "0016_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "streak_freezes",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("milestone_day", sa.Integer(), nullable=False),
        sa.Column("used_on_date", sa.Date(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("milestone_day > 0", name="milestone_day_positive"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_streak_freezes_user_id_milestone_day",
        "streak_freezes",
        ["user_id", "milestone_day"],
        unique=True,
    )
    op.create_index(
        "ix_streak_freezes_user_id_available",
        "streak_freezes",
        ["user_id"],
        postgresql_where=sa.text("used_on_date IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_streak_freezes_user_id_available", table_name="streak_freezes")
    op.drop_index("uq_streak_freezes_user_id_milestone_day", table_name="streak_freezes")
    op.drop_table("streak_freezes")
