"""Restaurant registry with case-insensitive dedupe.

Both mappings are optional, by design: coordinates may be absent (filled in
later, never required) and a food log may have no restaurant at all, so a
home-cooked meal is never blocked from being logged.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_uuid7


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    area: Mapped[str | None] = mapped_column(String(120))
    latitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Dedupe on lowercased name + area so "Kolachi" and "kolachi " in the
        # same area collapse to one row rather than fragmenting the map pins
        # and the "most-visited restaurant" stat.
        Index(
            "uq_restaurants_name_area_lower",
            func.lower(name),
            func.coalesce(func.lower(area), ""),
            unique=True,
        ),
        Index("ix_restaurants_name_trgm", text("name gin_trgm_ops"), postgresql_using="gin"),
    )
