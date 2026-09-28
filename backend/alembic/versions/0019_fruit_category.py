"""add a fruit category

Revision ID: 0019_fruit_category
Revises: 0018_onboarding_quiz
Create Date: 2026-09-29

There was nowhere to log a piece of fruit. Every existing category is a
prepared dish -- Salad came closest and is still wrong twice over: a banana
is not a salad, and Salad's 200 to 360 kcal range would price it like one.

A migration rather than only an edit to app/seed/data.py, for the same reason
0010_split_drinks was one: that file is read by a fresh install, and does
nothing at all for a database that has already run 0002.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_fruit_category"
down_revision: str | Sequence[str] | None = "0018_onboarding_quiz"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept in step with app/seed/data.py, which is what a fresh database reads.
SLUG = "fruit"
NAME = "Fruit"
MIN_CALORIES = 70
MAX_CALORIES = 140


def upgrade() -> None:
    conn = op.get_bind()

    # Same cuisine every other catch-all category uses, resolved by slug
    # rather than a hardcoded id, because identity ids are assigned by the
    # database.
    cuisine_id = conn.execute(
        sa.text("SELECT id FROM cuisines WHERE slug = 'continental'")
    ).scalar_one()

    conn.execute(
        sa.text(
            "INSERT INTO food_categories "
            "(cuisine_id, slug, name, base_calorie_min, base_calorie_max, is_junk) "
            "VALUES (:cuisine_id, :slug, :name, :base_calorie_min, :base_calorie_max, false) "
            "ON CONFLICT (slug) DO NOTHING"
        ),
        {
            "cuisine_id": cuisine_id,
            "slug": SLUG,
            "name": NAME,
            "base_calorie_min": MIN_CALORIES,
            "base_calorie_max": MAX_CALORIES,
        },
    )


def downgrade() -> None:
    conn = op.get_bind()

    # food_logs references food_categories with ON DELETE RESTRICT, so this
    # refuses rather than cascades if anyone has already logged a banana. That
    # is the right failure: the alternative is silently moving somebody's
    # meals into a category that means something else.
    conn.execute(sa.text("DELETE FROM food_categories WHERE slug = :slug"), {"slug": SLUG})
