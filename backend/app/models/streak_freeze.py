"""Streak freezes: a milestone reward that protects one future junk day.

Earned automatically when a streak crosses one of the milestone lengths (see
MILESTONE_DAYS in services/insights.py), and spent automatically the next time
a junk day would otherwise break the streak. used_on_date is null while the
freeze is still available and is filled in with the exact day it protected
once it is spent, which is what lets compute_streaks tell "unspent" from
"already used" without a separate status column that could drift out of sync
with it.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_uuid7


class StreakFreeze(Base):
    __tablename__ = "streak_freezes"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Which streak length earned this freeze. The unique index below is what
    # stops a streak sitting at 7 across several requests from granting a
    # second one for the same milestone.
    milestone_day: Mapped[int] = mapped_column(Integer, nullable=False)
    # Null while unspent. Filled in with the junk day it protected the one
    # time compute_streaks consumes it.
    used_on_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("milestone_day > 0", name="milestone_day_positive"),
        Index("uq_streak_freezes_user_id_milestone_day", "user_id", "milestone_day", unique=True),
        # The hot lookup: how many of this user's freezes are still available,
        # and which is the oldest. Partial, since spent freezes are never
        # queried by anything once compute_streaks has recorded the day they
        # covered.
        Index(
            "ix_streak_freezes_user_id_available",
            "user_id",
            postgresql_where=text("used_on_date IS NULL"),
        ),
    )
