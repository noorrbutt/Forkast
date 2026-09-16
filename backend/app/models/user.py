"""Users and refresh tokens."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
