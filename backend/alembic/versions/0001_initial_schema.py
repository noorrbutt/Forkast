"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-16

Most of this was produced by autogenerate. The pieces added by hand are the
pg_trgm extension and the expression indexes at the end, which SQLAlchemy
cannot reflect back from PostgreSQL and therefore cannot autogenerate. Those
same index names are listed in alembic/env.py's EXPRESSION_INDEXES so that
autogenerate ignores them rather than proposing to drop and recreate them on
every run.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Trigram matching powers the typo tolerant search, so "biriani" still
    # finds "Biryani". Must exist before the gin_trgm_ops indexes below.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "cuisines",
        sa.Column("id", sa.SmallInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("slug", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("emoji", sa.String(length=8), nullable=True),
        sa.Column("sort_order", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cuisines")),
        sa.UniqueConstraint("slug", name=op.f("uq_cuisines_slug")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "timezone",
            sa.String(length=64),
            server_default=sa.text("'Asia/Karachi'"),
            nullable=False,
        ),
        sa.Column(
            "goal",
            sa.Enum("cut", "maintain", "bulk", name="goal", native_enum=False, length=16),
            server_default=sa.text("'maintain'"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_table(
        "ai_plans",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "goal",
            sa.Enum("cut", "maintain", "bulk", name="goal", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("generated_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ai_plans_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_plans")),
    )
    op.create_table(
        "food_categories",
        sa.Column("id", sa.SmallInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("cuisine_id", sa.SmallInteger(), nullable=False),
        sa.Column("slug", sa.String(length=48), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("base_calorie_min", sa.Integer(), nullable=False),
        sa.Column("base_calorie_max", sa.Integer(), nullable=False),
        sa.Column("is_junk", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            "base_calorie_min > 0 AND base_calorie_min <= base_calorie_max",
            name=op.f("ck_food_categories_calorie_range"),
        ),
        sa.ForeignKeyConstraint(
            ["cuisine_id"],
            ["cuisines.id"],
            name=op.f("fk_food_categories_cuisine_id_cuisines"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_food_categories")),
        sa.UniqueConstraint("slug", name=op.f("uq_food_categories_slug")),
    )
    op.create_index("ix_food_categories_cuisine_id", "food_categories", ["cuisine_id"], unique=False)
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_refresh_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_refresh_tokens_token_hash")),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False)
    op.create_table(
        "restaurants",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("area", sa.String(length=120), nullable=True),
        sa.Column("latitude", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("longitude", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_restaurants_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_restaurants")),
    )
    op.create_table(
        "food_logs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("dish_name", sa.String(length=200), nullable=False),
        sa.Column("category_id", sa.SmallInteger(), nullable=False),
        sa.Column("restaurant_id", sa.Uuid(), nullable=True),
        sa.Column("area", sa.String(length=120), nullable=True),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("fun_scale", sa.SmallInteger(), nullable=True),
        sa.Column(
            "friend_scale",
            sa.Enum(
                "solo", "small_group", "squad", name="friend_scale", native_enum=False, length=16
            ),
            nullable=True,
        ),
        sa.Column(
            "serving_size",
            sa.Enum("small", "medium", "large", name="serving_size", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("estimated_calories", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint(
            "estimated_calories >= 0", name=op.f("ck_food_logs_calories_non_negative")
        ),
        sa.CheckConstraint(
            "fun_scale IS NULL OR fun_scale BETWEEN 1 AND 5",
            name=op.f("ck_food_logs_fun_scale_range"),
        ),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name=op.f("ck_food_logs_rating_range")),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["food_categories.id"],
            name=op.f("fk_food_logs_category_id_food_categories"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["restaurant_id"],
            ["restaurants.id"],
            name=op.f("fk_food_logs_restaurant_id_restaurants"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_food_logs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_food_logs")),
    )
    op.create_index("ix_food_logs_restaurant_id", "food_logs", ["restaurant_id"], unique=False)
    op.create_index(
        "ix_food_logs_user_id_category_id", "food_logs", ["user_id", "category_id"], unique=False
    )

    # Expression indexes, written as raw SQL because autogenerate cannot
    # reflect them. See the module docstring.

    # Case insensitive unique email. A functional index rather than citext or a
    # nondeterministic collation, since the latter disables B-tree
    # deduplication and breaks pattern matching.
    op.execute("CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email))")

    # Restaurant dedupe. coalesce keeps rows with no area from all colliding on
    # NULL, which in PostgreSQL would otherwise compare as distinct and let
    # duplicates through.
    op.execute(
        "CREATE UNIQUE INDEX uq_restaurants_name_area_lower "
        "ON restaurants (lower(name), coalesce(lower(area), ''))"
    )

    # The dashboard, streak and history queries are all user scoped and newest
    # first, so the index order matches the query order.
    op.execute(
        "CREATE INDEX ix_food_logs_user_id_created_at ON food_logs (user_id, created_at DESC)"
    )
    op.execute("CREATE INDEX ix_ai_plans_user_id_created_at ON ai_plans (user_id, created_at DESC)")

    op.execute("CREATE INDEX ix_cuisines_name_trgm ON cuisines USING gin (name gin_trgm_ops)")
    op.execute(
        "CREATE INDEX ix_food_categories_name_trgm ON food_categories USING gin (name gin_trgm_ops)"
    )
    op.execute("CREATE INDEX ix_restaurants_name_trgm ON restaurants USING gin (name gin_trgm_ops)")
    op.execute(
        "CREATE INDEX ix_food_logs_dish_name_trgm ON food_logs USING gin (dish_name gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_food_logs_dish_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_restaurants_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_food_categories_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_cuisines_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_ai_plans_user_id_created_at")
    op.execute("DROP INDEX IF EXISTS ix_food_logs_user_id_created_at")
    op.execute("DROP INDEX IF EXISTS uq_restaurants_name_area_lower")
    op.execute("DROP INDEX IF EXISTS uq_users_email_lower")

    op.drop_index("ix_food_logs_user_id_category_id", table_name="food_logs")
    op.drop_index("ix_food_logs_restaurant_id", table_name="food_logs")
    op.drop_table("food_logs")
    op.drop_table("restaurants")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index("ix_food_categories_cuisine_id", table_name="food_categories")
    op.drop_table("food_categories")
    op.drop_table("ai_plans")
    op.drop_table("users")
    op.drop_table("cuisines")

    # Dropped last so `downgrade base` really does leave an empty database.
    # There are no native enum types to clean up here, which is exactly why the
    # closed vocabularies are varchar plus check rather than PostgreSQL enums.
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
