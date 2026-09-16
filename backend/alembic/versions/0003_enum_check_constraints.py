"""add the missing CHECK constraints for the closed vocabularies

Revision ID: 0003_enum_checks
Revises: 0002_reference_data
Create Date: 2026-09-16

The plan calls for the closed vocabularies (serving_size, friend_scale, goal) to
be stored as varchar with a named CHECK, deliberately avoiding native PostgreSQL
enums so that downgrades stay clean. The varchar half landed, the CHECK half did
not: SQLAlchemy 2.0 defaults Enum.create_constraint to False, so
Enum(native_enum=False) silently produces a bare varchar with no constraint at
all. The database was accepting serving_size = 'gigantic'.

Two things make this worth a migration of its own rather than an edit to 0001.
Migration 0001 is already committed, and editing an applied migration is a habit
worth not forming. More importantly, `alembic check` cannot catch this: Alembic
autogenerate does not detect CHECK constraints, so it reported no drift the
entire time the constraints were missing. Anything in this class has to be
written by hand and verified by querying the database, not by trusting the
drift check.

The application layer was never at risk, because pydantic rejects an invalid
value long before it reaches SQL. This closes the gap for anything that reaches
the database another way: a direct SQL insert, a seed script, a future bulk
import, or a bug in a later code path.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_enum_checks"
down_revision: str | Sequence[str] | None = "0002_reference_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (short name, table, SQL condition). Only the short name is given, because
# create_check_constraint runs it through the metadata naming convention
# ck_%(table_name)s_%(constraint_name)s. Passing the full name here would
# produce ck_food_logs_ck_food_logs_serving_size and would then not match the
# name the models generate from the Enum, which is what the drift check and any
# future ALTER both rely on.
CONSTRAINTS: list[tuple[str, str, str]] = [
    (
        "serving_size",
        "food_logs",
        "serving_size IN ('small', 'medium', 'large')",
    ),
    (
        "friend_scale",
        "food_logs",
        "friend_scale IS NULL OR friend_scale IN ('solo', 'small_group', 'squad')",
    ),
    (
        "goal",
        "users",
        "goal IN ('cut', 'maintain', 'bulk')",
    ),
    (
        "goal",
        "ai_plans",
        "goal IN ('cut', 'maintain', 'bulk')",
    ),
]


def upgrade() -> None:
    for name, table, condition in CONSTRAINTS:
        op.create_check_constraint(name, table, condition)


def downgrade() -> None:
    # op.f marks the name as already final so the convention is not applied a
    # second time on the way out.
    for name, table, _ in reversed(CONSTRAINTS):
        op.drop_constraint(op.f(f"ck_{table}_{name}"), table, type_="check")
