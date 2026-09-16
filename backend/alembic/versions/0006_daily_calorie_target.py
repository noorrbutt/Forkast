"""Add a daily calorie target to users.

Nullable on purpose. Null means the user has never set a target, which the
dashboard renders as a plain total for the day; a number turns the same total
into progress against it. Defaulting everyone to some invented figure would
make the app assert a goal nobody chose.

Revision ID: 0006_daily_calorie_target
Revises: 0005_burn_logs
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_daily_calorie_target"
down_revision: str | Sequence[str] | None = "0005_burn_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("daily_calorie_target", sa.Integer(), nullable=True))
    # Only the short constraint name here. The naming convention in
    # models/base.py adds the ck_users_ prefix, and passing the full name
    # produces ck_users_ck_users_calorie_target_plausible.
    op.create_check_constraint(
        "calorie_target_plausible",
        "users",
        "daily_calorie_target IS NULL OR "
        "(daily_calorie_target >= 800 AND daily_calorie_target <= 10000)",
    )


def downgrade() -> None:
    # Short name here too. drop_constraint runs through the same naming
    # convention as create, so passing the already prefixed name asks Postgres
    # to drop ck_users_ck_users_calorie_target_plausible, which does not exist.
    op.drop_constraint("calorie_target_plausible", "users", type_="check")
    op.drop_column("users", "daily_calorie_target")
