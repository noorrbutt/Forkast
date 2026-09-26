"""Users, their refresh tokens and their profile pictures."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    Uuid,
    func,
    select,
    text,
)
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.models.base import Base, new_uuid7, str_enum
from app.models.enums import Goal


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    # Nullable since 0011. An account that only ever signed in with Google has
    # no password and never had one, and a placeholder hash would be a lie the
    # rest of the code could not tell apart from a real one. The check
    # constraint below is what stops this becoming an account nobody can open.
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Google's `sub`. The stable identifier for a Google account, and the only
    # one safe to key on: an address can be changed or handed to somebody else
    # inside a Workspace domain, `sub` cannot.
    google_sub: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Both nullable, and null is not the empty string. Null means nobody has
    # ever told us this person's name: every account registered before 0011 is
    # in that position, and so is one made from a Google token that carried no
    # name claim. Registration asks for both and refuses blanks, so null here
    # can only ever be an account that predates the question or a Google token
    # that did not answer it.
    first_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Streaks are "days without a junk-flagged log", so the day boundary has to
    # be the user's local one -- an 11:30pm meal must count for that evening.
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=text("'Asia/Karachi'")
    )
    # Current goal. ai_plans.goal separately snapshots the goal each plan was
    # generated under, so old plans stay truthful after this changes.
    goal: Mapped[Goal] = mapped_column(
        str_enum(Goal, "goal", length=16), nullable=False, server_default=text("'maintain'")
    )
    # A daily ceiling in kcal to measure the day against. Null is meaningful and
    # is not the same as zero: null means the user has never set one, so the
    # dashboard shows a plain total, while a number turns that total into
    # progress against it.
    daily_calorie_target: Mapped[int | None] = mapped_column(nullable=True)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    email_verification_tokens: Mapped[list[EmailVerificationToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def has_password(self) -> bool:
        """Whether this account can be opened with a password at all.

        A plain Python property rather than a column_property like has_avatar,
        because the answer is already in the row that has been loaded: the
        password lives on users, the picture does not. The client needs it to
        know which question to ask before deleting the account, since there is
        no password to ask a Google-only account for.
        """
        return self.password_hash is not None

    __table_args__ = (
        # Functional unique index rather than citext or a nondeterministic
        # collation: the latter disables B-tree deduplication and breaks
        # pattern matching.
        Index("uq_users_email_lower", func.lower(email), unique=True),
        # One Forkast account per Google account. Without this, two rows could
        # both claim the same `sub` and signing in with Google would return
        # whichever the query happened to reach first.
        Index(
            "uq_users_google_sub",
            google_sub,
            unique=True,
            # Partial, so the many accounts with no Google identity are not all
            # fighting over a single NULL. Postgres already treats NULLs as
            # distinct in a unique index, so this is about index size rather
            # than correctness.
            postgresql_where=google_sub.isnot(None),
        ),
        # Every account keeps at least one way in. Making password_hash
        # nullable opened the door to a row with neither a password nor a
        # Google identity, which is an account that exists and that nobody,
        # including its owner, can ever sign in to.
        CheckConstraint(
            "password_hash IS NOT NULL OR google_sub IS NOT NULL",
            name="has_a_way_in",
        ),
        # The ceiling catches a stray extra digit before it silently makes
        # every day look like a success. There is deliberately no meaningful
        # floor: Forkast knows no height, weight, age or activity level, so it
        # is in no position to tell anyone their target is too low. Zero is
        # allowed and reads downstream as no target, which is what the
        # dashboard already does with any non-positive value.
        CheckConstraint(
            "daily_calorie_target IS NULL OR "
            "(daily_calorie_target >= 0 AND daily_calorie_target <= 10000)",
            name="calorie_target_plausible",
        ),
    )


class RefreshToken(Base):
    """One row per issued refresh token. Only the SHA-256 hash is stored, so a
    database leak does not hand out usable sessions."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Stable across rotation: refreshing revokes this row and inserts a new one
    # carrying the same session_id, so one sign-in is one session however many
    # times its token has rotated. Access tokens name it in their `sid` claim,
    # which is what lets logout end them early.
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_user_id", "user_id"),
        # Every authenticated request checks this session is still live, so it
        # is the hottest lookup in the schema. The partial index keeps revoked
        # rows out of the hot path while still leaving them available for reuse
        # detection and logout semantics.
        Index(
            "ix_refresh_tokens_live_session",
            "session_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )


class EmailVerificationToken(Base):
    """One-time verification links. Only the SHA-256 hash is persisted."""

    __tablename__ = "email_verification_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="email_verification_tokens")

    __table_args__ = (
        Index("ux_email_verification_tokens_token_hash", "token_hash", unique=True),
        Index("ix_email_verification_tokens_user_id", "user_id"),
    )


# 512 KiB. Deliberately under Starlette's 1 MiB request body ceiling, which
# rejects the upload before the route ever runs, so a larger number here would
# never be reachable and the friendlier message on the route would never be
# seen. Lower than the meal photo ceiling because this is a small square shown
# at the size of a thumbnail, so anything bigger is bytes nobody ever sees.
MAX_AVATAR_BYTES = 512 * 1024


class UserAvatar(Base):
    """One profile picture per account, stored as bytes in Postgres.

    Its own table rather than a column on users, because users is read on every
    authenticated request and an image is orders of magnitude larger than the
    row it hangs off; a column would drag the picture through the auth check.

    Bytes in the database rather than object storage is the same trade
    food_log_photos makes: no second service and no account, it survives a
    redeploy that would wipe a container's disk, and it is covered by the same
    backup as everything else. The route hands the caller bytes rather than a
    location, so this can become a URL column later without any client noticing.
    """

    __tablename__ = "user_avatars"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # No relationship back to User on purpose. Nothing needs to navigate from a
    # user row to these bytes, the routes load the row they want directly, and
    # leaving the attribute off means no accidental access can pull an image
    # into the query that authenticates every request.

    __table_args__ = (
        CheckConstraint(
            f"byte_size > 0 AND byte_size <= {MAX_AVATAR_BYTES}",
            name="avatar_size_sane",
        ),
        # One picture per account. A second row would make "the" avatar
        # ambiguous, and there is no ordering column to break the tie.
        Index("uq_user_avatars_user_id", "user_id", unique=True),
    )


# Whether an account has a picture, answered by the database as part of the same
# SELECT that loads the user. A boolean rather than a relationship, so /me costs
# one EXISTS and never a byte of image data. Defined here rather than inside the
# class because it needs UserAvatar, which needs User.
User.has_avatar = column_property(
    select(1).where(UserAvatar.user_id == User.id).exists().label("has_avatar"),
    # A SQL expression property is expired by default whenever its row is
    # flushed, and re-reading it is IO, which a route that has already returned
    # its user cannot do: serialising the reply would raise MissingGreenlet.
    # Nothing that writes to users can change this answer anyway, because the
    # picture lives in another table, so the loaded value is still true after an
    # UPDATE here. The routes that add or remove a picture re-read the row
    # themselves, since writing user_avatars would not expire this either way.
    expire_on_flush=False,
)
