"""add email verification state and one-time tokens

Revision ID: 0015_email_verification
Revises: 0014_food_logs_client_id
Create Date: 2026-09-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_email_verification"
down_revision = "0014_food_logs_client_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.execute("UPDATE users SET email_verified = true")

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_email_verification_tokens_token_hash",
        "email_verification_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_email_verification_tokens_user_id",
        "email_verification_tokens",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_verification_tokens_user_id", table_name="email_verification_tokens")
    op.drop_index(
        "ux_email_verification_tokens_token_hash", table_name="email_verification_tokens"
    )
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "email_verified")