"""Add photos for meals.

Bytes live in Postgres rather than in object storage. That needs no second
service and no account, survives a redeploy that would wipe a container's disk,
and is covered by the same backup as everything else. The app resizes before
uploading, so rows land well under the ceiling below.

Revision ID: 0007_food_log_photos
Revises: 0006_daily_calorie_target
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_food_log_photos"
down_revision: str | Sequence[str] | None = "0006_daily_calorie_target"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAX_PHOTO_BYTES = 1000 * 1024


def upgrade() -> None:
    op.create_table(
        "food_log_photos",
        sa.Column(
            "id",
            sa.Uuid(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "food_log_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("food_logs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Short name only. The naming convention in models/base.py adds the
        # ck_food_log_photos_ prefix, and passing the full name would produce it
        # twice.
        sa.CheckConstraint(
            f"byte_size > 0 AND byte_size <= {MAX_PHOTO_BYTES}",
            name="photo_size_sane",
        ),
    )
    # One photo per meal, enforced rather than assumed, so a retried upload
    # replaces the picture instead of quietly stacking a second one.
    op.create_index(
        "uq_food_log_photos_food_log_id",
        "food_log_photos",
        ["food_log_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_food_log_photos_food_log_id", table_name="food_log_photos")
    op.drop_table("food_log_photos")
