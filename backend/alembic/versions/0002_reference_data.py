"""reference data: cuisines and food categories

Revision ID: 0002_reference_data
Revises: 0001_initial
Create Date: 2026-09-16

Cuisines and food categories are reference data, not demo content. The log
screen cannot function without them, so they belong in a migration rather than
in the seed script: `alembic upgrade head` on an empty database has to produce
something the app can actually run against.

The rows are read from app.seed.data so there is one source of truth rather than
a second copy that silently drifts. The tradeoff is that this migration is not
frozen in time the way a migration normally is: editing data.py changes what a
fresh `upgrade` inserts. That is the right call while the category list is still
being settled. Once real users exist, changes should come as new migrations
instead of edits to this one.

Note that food_categories is referenced by food_logs with ON DELETE RESTRICT, so
downgrading this revision fails if any logs exist. That is deliberate. Clear the
demo data first (see app/seed/run.py --reset).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.seed.data import CUISINES, FOOD_CATEGORIES

revision: str = "0002_reference_data"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            "INSERT INTO cuisines (slug, name, emoji, sort_order) "
            "VALUES (:slug, :name, :emoji, :sort_order) "
            "ON CONFLICT (slug) DO NOTHING"
        ),
        [
            {"slug": c.slug, "name": c.name, "emoji": c.emoji, "sort_order": c.sort_order}
            for c in CUISINES
        ],
    )

    # Identity ids are assigned by the database, so resolve slug to id rather
    # than assuming the insert order produced 1..N.
    cuisine_ids = dict(conn.execute(sa.text("SELECT slug, id FROM cuisines")).all())

    conn.execute(
        sa.text(
            "INSERT INTO food_categories "
            "(cuisine_id, slug, name, base_calorie_min, base_calorie_max, is_junk) "
            "VALUES (:cuisine_id, :slug, :name, :base_calorie_min, :base_calorie_max, :is_junk) "
            "ON CONFLICT (slug) DO NOTHING"
        ),
        [
            {
                "cuisine_id": cuisine_ids[c.cuisine_slug],
                "slug": c.slug,
                "name": c.name,
                "base_calorie_min": c.base_calorie_min,
                "base_calorie_max": c.base_calorie_max,
                "is_junk": c.is_junk,
            }
            for c in FOOD_CATEGORIES
        ],
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Only remove what this migration inserted. Anything a user added later
    # stays put.
    conn.execute(
        sa.text("DELETE FROM food_categories WHERE slug = ANY(:slugs)"),
        {"slugs": [c.slug for c in FOOD_CATEGORIES]},
    )
    conn.execute(
        sa.text("DELETE FROM cuisines WHERE slug = ANY(:slugs)"),
        {"slugs": [c.slug for c in CUISINES]},
    )
