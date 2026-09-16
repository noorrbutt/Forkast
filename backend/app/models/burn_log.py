"""Calories burned, entered by hand.

One row per user per day, not one per workout. That is the whole design: the
brief was that someone types what they burned today if they feel like it, and a
single editable number matches how people actually know that figure. It usually
comes off a watch or a treadmill as one daily total, so asking them to itemise
it would invent work that produces the same number.

The day is stored as a plain date rather than derived from a timestamp, because
it is the user's own calendar day and they are the one asserting it. A
timestamptz would force every read to convert back through their timezone to
recover a value they already knew when they typed it.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_uuid7


class BurnLog(Base):
    __tablename__ = "burn_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    day: Mapped[dt.date] = mapped_column(Date, nullable=False)
    calories: Mapped[int] = mapped_column(nullable=False)

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # An upper bound as well as a lower one. Roughly ten thousand is beyond
        # what an ultramarathon burns, so anything above it is a typo, and a
        # stray zero would otherwise swamp the net figure and the chart scale.
        CheckConstraint("calories >= 0 AND calories <= 10000", name="calories_plausible"),
        # One number per day is the model, and the database is what makes that
        # true rather than the handler remembering to check.
        Index("uq_burn_logs_user_id_day", "user_id", "day", unique=True),
    )
