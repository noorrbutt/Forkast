"""store the photo estimate's macros, and how a log's calories were priced

Revision ID: 0020_photo_macros_source
Revises: 0019_fruit_category
Create Date: 2026-09-30

Two gaps in the same feature. The photo flow already asks the model for
protein, carbs and fat (PhotoMacros in services/ai/schemas.py) and threw the
answer away the moment the estimate screen closed, because nothing in
food_logs had anywhere to put it. And the number a photo estimate shows in
the confirm screen was never what got saved -- create_log always re-priced
the meal from the category midpoint, so the figure someone looked at and
approved was not the figure on their diary entry. `calorie_source` is what
lets a log say "priced from a photo" instead of only ever "priced from its
category", which the client needs to know to label the number honestly
rather than imply a false precision on an old-style entry that never saw a
photo at all.

Named `calorie_source`, not `estimate_source`: that name is already taken by
the unrelated, per-request EstimateSource ("ai" vs "local", whether Groq or
the deterministic stub answered THIS call) that FoodLogOut already carries.
This column answers a different question -- how THIS row's stored figure was
priced, once, at creation -- and reusing the name would make two genuinely
different concepts look like the same field wherever both are visible.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_photo_macros_source"
down_revision: str | Sequence[str] | None = "0019_fruit_category"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("food_logs", sa.Column("protein_g", sa.Numeric(6, 1), nullable=True))
    op.add_column("food_logs", sa.Column("carbs_g", sa.Numeric(6, 1), nullable=True))
    op.add_column("food_logs", sa.Column("fat_g", sa.Numeric(6, 1), nullable=True))
    # Nullable, not an enum with a default: every log made before this exists
    # has no recorded source, and "category" would be a guess dressed up as a
    # fact for rows this migration cannot actually know the provenance of.
    op.add_column(
        "food_logs",
        sa.Column("calorie_source", sa.String(16), nullable=True),
    )
    op.create_check_constraint(
        "ck_food_logs_calorie_source",
        "food_logs",
        "calorie_source IS NULL OR calorie_source IN ('photo', 'category')",
    )
    op.create_check_constraint(
        "ck_food_logs_macros_non_negative",
        "food_logs",
        "(protein_g IS NULL OR protein_g >= 0) "
        "AND (carbs_g IS NULL OR carbs_g >= 0) "
        "AND (fat_g IS NULL OR fat_g >= 0)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_food_logs_macros_non_negative", "food_logs", type_="check")
    op.drop_constraint("ck_food_logs_calorie_source", "food_logs", type_="check")
    op.drop_column("food_logs", "calorie_source")
    op.drop_column("food_logs", "fat_g")
    op.drop_column("food_logs", "carbs_g")
    op.drop_column("food_logs", "protein_g")
