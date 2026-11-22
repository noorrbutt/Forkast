"""add portion multiplier to food logs

Revision ID: 0025_food_log_portion_multiplier
Revises: 0024_dish_synonyms
Create Date: 2026-11-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_food_log_portion_multiplier"
down_revision: str | Sequence[str] | None = "0024_dish_synonyms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "food_logs",
        sa.Column(
            "portion_multiplier",
            sa.Float(),
            server_default=sa.text("1.0"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "portion_multiplier_range",
        "food_logs",
        "portion_multiplier BETWEEN 0.25 AND 3.0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_food_logs_portion_multiplier_range",
        "food_logs",
        type_="check",
    )
    op.drop_column("food_logs", "portion_multiplier")
