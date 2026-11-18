"""seed localized and roman-Urdu dish synonyms

Revision ID: 0024_dish_synonyms
Revises: 0023_eggs_and_rice_categories
Create Date: 2026-11-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_dish_synonyms"
down_revision: str | Sequence[str] | None = "0023_eggs_and_rice_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Keep in step with app/seed/data.py. Migrations carry their own immutable
# reference-data snapshot so later edits cannot change an already applied one.
SYNONYMS = (
    ("نہاری", "nihari", "nihari"),
    ("nihaari", "nihari", "nihari"),
    ("حلیم", "haleem", "haleem"),
    ("daleem", "haleem", "haleem"),
    ("چائے پراٹھا", "chai paratha", "breakfast"),
    ("بریانی", "biryani", "biryani"),
    ("biriyani", "biryani", "biryani"),
    ("کڑاہی", "karahi", "karahi"),
    ("قورمہ", "karahi", "karahi"),
    ("پراٹھا", "paratha", "paratha"),
    ("parantha", "paratha", "paratha"),
    ("چائے", "chai", "tea_coffee"),
    ("دودھ پتی", "chai", "tea_coffee"),
    ("دال چاول", "daal chawal", "daal_chawal"),
    ("حلوہ پوری", "halwa puri", "halwa_puri"),
    ("سموسہ", "samosa", "samosa_pakora"),
    ("روٹی", "roti", "paratha"),
    ("نان", "naan", "paratha"),
)


def upgrade() -> None:
    op.create_table(
        "dish_synonyms",
        sa.Column("alias", sa.String(length=100), nullable=False),
        sa.Column("dish_name", sa.String(length=200), nullable=False),
        sa.Column("category_id", sa.SmallInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["category_id"], ["food_categories.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("alias", name=op.f("pk_dish_synonyms")),
    )
    op.create_index(
        "ix_dish_synonyms_alias_trgm",
        "dish_synonyms",
        ["alias"],
        postgresql_using="gin",
        postgresql_ops={"alias": "gin_trgm_ops"},
    )

    conn = op.get_bind()
    category_ids = dict(conn.execute(sa.text("SELECT slug, id FROM food_categories")).all())
    conn.execute(
        sa.text(
            "INSERT INTO dish_synonyms (alias, dish_name, category_id) "
            "VALUES (:alias, :dish_name, :category_id)"
        ),
        [
            {"alias": alias, "dish_name": dish_name, "category_id": category_ids[slug]}
            for alias, dish_name, slug in SYNONYMS
        ],
    )


def downgrade() -> None:
    op.drop_table("dish_synonyms")
