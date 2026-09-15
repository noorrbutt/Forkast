"""Generated eating plans."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_uuid7, str_enum
from app.models.enums import Goal


class AIPlan(Base):
    __tablename__ = "ai_plans"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Snapshot of the goal this plan was generated under -- not a live pointer
    # to users.goal, so plan history stays truthful when the goal changes.
    goal: Mapped[Goal] = mapped_column(str_enum(Goal, "goal", length=16), nullable=False)
    generated_plan: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    model: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_ai_plans_user_id_created_at", "user_id", text("created_at DESC")),)
