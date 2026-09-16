"""calories burned, one editable number per user per day

Revision ID: 0005_burn_logs
Revises: 0004_sessions_and_rate_limits
Create Date: 2026-09-16

The dashboard has only ever counted calories in. This is the other side, so it
can show a net figure rather than a total that quietly ignores a two hour walk.

One row per user per day rather than one per workout, enforced by the unique
index rather than by a handler remembering to check. People usually know this
number as a single daily total off a watch, so itemising it would invent work
that produces the same answer.

The upper bound on the check is a typo guard. Ten thousand is past what an
ultramarathon burns, and a stray zero would otherwise swamp both the net figure
and the scale of the chart it appears in.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_burn_logs"
down_revision: str | Sequence[str] | None = "0004_sessions_and_rate_limits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "burn_logs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        # A plain date: it is the user's own calendar day, asserted by them,
        # not something to be recovered from a timestamp on every read.
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("calories", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint(
            "calories >= 0 AND calories <= 10000", name=op.f("ck_burn_logs_calories_plausible")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_burn_logs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_burn_logs")),
    )
    # Unique, so "one number per day" is a property of the schema. It also
    # serves the dashboard's lookup, which is always by user and day range.
    op.create_index("uq_burn_logs_user_id_day", "burn_logs", ["user_id", "day"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_burn_logs_user_id_day", table_name="burn_logs")
    op.drop_table("burn_logs")
