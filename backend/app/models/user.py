"""Users, their refresh tokens and their profile pictures."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
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
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
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
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Functional unique index rather than citext or a nondeterministic
        # collation: the latter disables B-tree deduplication and breaks
        # pattern matching.
        Index("uq_users_email_lower", func.lower(email), unique=True),
        # Wide enough for anyone from a cutting sedentary adult to an athlete,
        # narrow enough that a stray extra digit is caught before it silently
        # makes every day look like a success.
        CheckConstraint(
            "daily_calorie_target IS NULL OR "
            "(daily_calorie_target >= 800 AND daily_calorie_target <= 10000)",
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
        # is the hottest lookup in the schema.
        Index("ix_refresh_tokens_session_id", "session_id"),
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
