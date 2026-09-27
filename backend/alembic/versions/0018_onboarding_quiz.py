"""add onboarding quiz answers to users

Revision ID: 0018_onboarding_quiz
Revises: 0017_streak_freezes
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_onboarding_quiz"
down_revision = "0017_streak_freezes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("eating_out_frequency", sa.String(length=16), nullable=True))
    op.add_column("users", sa.Column("biggest_struggle", sa.String(length=16), nullable=True))
    op.create_check_constraint(
        "eating_out_frequency",
        "users",
        "eating_out_frequency IS NULL OR eating_out_frequency IN ('rarely', 'sometimes', 'often')",
    )
    op.create_check_constraint(
        "biggest_struggle",
        "users",
        "biggest_struggle IS NULL OR biggest_struggle IN "
        "('cravings', 'portion_size', 'eating_out', 'consistency', 'knowledge')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_biggest_struggle"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_eating_out_frequency"), "users", type_="check")
    op.drop_column("users", "biggest_struggle")
    op.drop_column("users", "eating_out_frequency")
