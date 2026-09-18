"""Give users a name, and let an account be opened with Google instead of a password.

Three changes, all on users, all of them the schema catching up with a sign up
screen that now asks for a first name, a last name and offers "Continue with
Google".

first_name and last_name are nullable, and null is not the empty string. Every
account that existed before this migration was created by a form that never
asked, so there is no name to backfill and inventing one from the local part of
the address would be a guess stored as a fact. Registration refuses blanks from
here on, so a null can only mean an account older than the question, or a Google
token that carried no name claim.

google_sub holds Google's `sub`, which is the only part of a Google identity
safe to key on. The address on a Google account can be changed by its owner, and
inside a Workspace domain it can be released and handed to somebody else; `sub`
survives both. The index is partial because the overwhelming majority of rows
will have no Google identity at all.

password_hash becomes nullable, which is the one change here that could hurt.
An account created through Google has no password and never had one, and the
alternative -- storing a hash of something unguessable so the column can stay
NOT NULL -- makes a row that every piece of code downstream reads as "this
account has a password", including the two routes that ask for it before doing
something irreversible. Nullable is the honest shape, and ck_users_has_a_way_in
is what stops it becoming a row with no password and no Google identity: an
account that exists and that nobody, its owner included, can ever open.

Revision ID: 0011_names_and_google_accounts
Revises: 0010_split_drinks
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_names_and_google_accounts"
down_revision: str | Sequence[str] | None = "0010_split_drinks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Short name only. The naming convention in models/base.py adds the ck_users_
# prefix, and passing the full name produces ck_users_ck_users_has_a_way_in.
CONSTRAINT = "has_a_way_in"


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("google_sub", sa.String(length=255), nullable=True))

    op.create_index(
        "uq_users_google_sub",
        "users",
        ["google_sub"],
        unique=True,
        postgresql_where=sa.text("google_sub IS NOT NULL"),
    )

    op.alter_column("users", "password_hash", existing_type=sa.Text(), nullable=True)
    op.create_check_constraint(
        CONSTRAINT,
        "users",
        "password_hash IS NOT NULL OR google_sub IS NOT NULL",
    )


def downgrade() -> None:
    # Any account that only ever signed in with Google has a null password_hash,
    # and there is nothing to put back in it: a password cannot be derived from
    # a Google identity, and inventing one would leave a row that looks openable
    # and is not. So those accounts are deleted rather than silently broken, and
    # that is said out loud here because it is data loss. Everything they own
    # cascades from users, which is the same path DELETE /me already takes.
    op.execute("DELETE FROM users WHERE password_hash IS NULL")

    op.drop_constraint(CONSTRAINT, "users", type_="check")
    op.alter_column("users", "password_hash", existing_type=sa.Text(), nullable=False)
    op.drop_index("uq_users_google_sub", table_name="users")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
