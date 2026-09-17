"""Add profile pictures.

Bytes live in Postgres rather than in object storage, the same trade
food_log_photos makes: no second service and no account, it survives a redeploy
that would wipe a container's disk, and it is covered by the same backup as
everything else. Its own table rather than a column on users, because users is
read on every authenticated request and an image has no business riding along
with the row that authenticates it.

Revision ID: 0008_user_avatars
Revises: 0007_food_log_photos
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_user_avatars"
down_revision: str | Sequence[str] | None = "0007_food_log_photos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAX_AVATAR_BYTES = 512 * 1024


def upgrade() -> None:
    op.create_table(
        "user_avatars",
        sa.Column(
            "id",
            sa.Uuid(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
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
        # ck_user_avatars_ prefix, and passing the full name would produce it
        # twice.
        sa.CheckConstraint(
            f"byte_size > 0 AND byte_size <= {MAX_AVATAR_BYTES}",
            name="avatar_size_sane",
        ),
    )
    # One picture per account, enforced rather than assumed, so a retried upload
    # replaces the picture instead of quietly stacking a second one.
    op.create_index(
        "uq_user_avatars_user_id",
        "user_avatars",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_user_avatars_user_id", table_name="user_avatars")
    op.drop_table("user_avatars")
