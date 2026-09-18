"""split the drink category into sweet drinks and tea or coffee

Revision ID: 0010_split_drinks
Revises: 0009_calorie_target_floor
Create Date: 2026-09-18

There was one drink category, "Beverage", at 170 to 300 kcal and flagged as
junk. Its seeded dishes are all sugary, so the flag was right for those, but the
name promised every drink and the app had nowhere else to put one. A cup of tea
had to be logged as junk, and junk ends a streak, so the most ordinary drink in
Karachi could only be recorded by either lying about it or losing a run.

Two changes, and neither of them moves an existing log. The sugary half keeps
the slug `beverage` and its calorie range and its junk flag, so every row in
food_logs already pointing at it stays exactly where it is and keeps counting
the way it always did; only the label it shows under changes. Tea and coffee
arrives as a new category that is not junk.

This is a migration rather than an edit to 0002 because 0002's own docstring
says so: it reads the rows from app.seed.data, so editing that file changes what
a fresh upgrade inserts, but it does nothing at all to a database that has
already run it. Real logs exist now, so the change has to travel separately.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_split_drinks"
down_revision: str | Sequence[str] | None = "0009_calorie_target_floor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept in step with app/seed/data.py, which is what a fresh database reads.
NEW_SLUG = "tea_coffee"
NEW_NAME = "Tea and Coffee"
NEW_MIN = 90
NEW_MAX = 160


def upgrade() -> None:
    conn = op.get_bind()

    # Rename only. The slug, the range and the junk flag are untouched, so the
    # logs filed under it are untouched too.
    conn.execute(
        sa.text("UPDATE food_categories SET name = 'Sweet Drink' WHERE slug = 'beverage'")
    )

    # Same cuisine as the category it splits away from, resolved by slug rather
    # than by a hardcoded id, because identity ids are assigned by the database.
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
            "slug": NEW_SLUG,
            "name": NEW_NAME,
            "base_calorie_min": NEW_MIN,
            "base_calorie_max": NEW_MAX,
        },
    )


def downgrade() -> None:
    conn = op.get_bind()

    # food_logs references food_categories with ON DELETE RESTRICT, so this
    # refuses rather than cascades if anyone has logged a tea. That is the right
    # failure: the alternative is silently moving somebody's meals into a
    # category that means something else.
    conn.execute(sa.text("DELETE FROM food_categories WHERE slug = :slug"), {"slug": NEW_SLUG})
    conn.execute(
        sa.text("UPDATE food_categories SET name = 'Beverage' WHERE slug = 'beverage'")
    )
