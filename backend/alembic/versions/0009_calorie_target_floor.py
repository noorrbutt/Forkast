"""Lower the daily calorie target floor from 800 to 0.

The original range was 800 to 10,000, described as wide enough for anyone from a
cutting sedentary adult to an athlete. The upper bound still does its job, which
is catching a stray extra digit before it silently makes every day look like a
success. The lower bound was doing something else: refusing a number the user
had deliberately chosen, on the app's opinion of what a sensible target is.

Forkast does not know enough about anyone to hold that opinion. It has no
height, no weight, no age and no activity level, so 800 is not a clinical floor
derived from anything, it is a guess that reads as the app arguing with you.

Zero itself stays meaningful without being a second way of saying null: the
dashboard already treats any non-positive target as no target, which is why the
ring simply is not drawn. So the range is now 0 to 10,000 and null still means
"never set one".

Revision ID: 0009_calorie_target_floor
Revises: 0008_user_avatars
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0009_calorie_target_floor"
down_revision: str | Sequence[str] | None = "0008_user_avatars"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Short name only. The naming convention in models/base.py adds the ck_users_
# prefix, and passing the full name produces
# ck_users_ck_users_calorie_target_plausible.
CONSTRAINT = "calorie_target_plausible"

OLD = "daily_calorie_target IS NULL OR (daily_calorie_target >= 800 AND daily_calorie_target <= 10000)"
NEW = "daily_calorie_target IS NULL OR (daily_calorie_target >= 0 AND daily_calorie_target <= 10000)"


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT, "users", type_="check")
    op.create_check_constraint(CONSTRAINT, "users", NEW)


def downgrade() -> None:
    # Anything already stored below the old floor would make the old constraint
    # unsatisfiable, so it is lifted to 800 first. That loses the user's own
    # number, which is why it happens here and is said out loud rather than
    # letting the migration fail halfway with the constraint half applied.
    op.execute(
        "UPDATE users SET daily_calorie_target = 800 "
        "WHERE daily_calorie_target IS NOT NULL AND daily_calorie_target < 800"
    )
    op.drop_constraint(CONSTRAINT, "users", type_="check")
    op.create_check_constraint(CONSTRAINT, "users", OLD)
