"""add eggs and rice categories, for dishes that don't fit the existing floors

Revision ID: 0023_eggs_and_rice_categories
Revises: 0022_circuit_breakers
Create Date: 2026-10-26

omelette and pulao were filed under "breakfast" (floor 450) and "biryani"
(floor 600) respectively, because those were the closest existing categories
and a dish's own range has to nest inside its category's. Neither dish
actually runs that heavy: a plain omelette is usually 150-300 kcal and a
home-style pulao 400-600, so both were pinned to a category floor well above
their real range, which overestimates exactly the people logging the
lighter, more common version of either dish.

A migration rather than only an edit to app/seed/data.py and
app/services/ai/desi.py, for the same reason 0019_fruit_category was one:
app/seed/data.py is read by a fresh install only, and does nothing for a
database that has already run past 0002.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_eggs_and_rice_categories"
down_revision: str | Sequence[str] | None = "0022_circuit_breakers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept in step with app/seed/data.py, which is what a fresh database reads.
CATEGORIES = [
    {"slug": "eggs", "name": "Eggs", "min": 150, "max": 350},
    {"slug": "rice", "name": "Rice", "min": 400, "max": 650},
]


def upgrade() -> None:
    conn = op.get_bind()

    cuisine_id = conn.execute(
        sa.text("SELECT id FROM cuisines WHERE slug = 'desi'")
    ).scalar_one()

    for category in CATEGORIES:
        conn.execute(
            sa.text(
                "INSERT INTO food_categories "
                "(cuisine_id, slug, name, base_calorie_min, base_calorie_max, is_junk) "
                "VALUES (:cuisine_id, :slug, :name, :min, :max, false) "
                "ON CONFLICT (slug) DO NOTHING"
            ),
            {"cuisine_id": cuisine_id, **category},
        )


def downgrade() -> None:
    conn = op.get_bind()

    # food_logs references food_categories with ON DELETE RESTRICT, so this
    # refuses rather than cascades if anyone has already logged an omelette
    # or a pulao under these. That is the right failure: the alternative is
    # silently moving somebody's meals into a category that means something
    # else.
    for category in CATEGORIES:
        conn.execute(
            sa.text("DELETE FROM food_categories WHERE slug = :slug"),
            {"slug": category["slug"]},
        )
