"""Reference tables: cuisines and food categories.

These use smallint identity PKs rather than UUIDv7. They are tiny closed
reference tables (~10 and ~34 rows), never created by a client, never synced
between devices and never guessable in a URL -- a 16-byte UUID would be pure
overhead.
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Identity, Index, SmallInteger, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Cuisine(Base):
    """The 'head category' -- where a dish comes from (Desi, Italian, ...)."""

    __tablename__ = "cuisines"

    id: Mapped[int] = mapped_column(SmallInteger, Identity(), primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    emoji: Mapped[str | None] = mapped_column(String(8))
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))

    categories: Mapped[list["FoodCategory"]] = relationship(
        back_populates="cuisine", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Trigram index so search tolerates typos ("italien" -> "Italian").
        Index("ix_cuisines_name_trgm", text("name gin_trgm_ops"), postgresql_using="gin"),
    )


class FoodCategory(Base):
    """A loggable category with the calorie range that constrains estimation."""

    __tablename__ = "food_categories"

    id: Mapped[int] = mapped_column(SmallInteger, Identity(), primary_key=True)
    cuisine_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("cuisines.id", ondelete="RESTRICT"), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    base_calorie_min: Mapped[int] = mapped_column(nullable=False)
    base_calorie_max: Mapped[int] = mapped_column(nullable=False)
    is_junk: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))

    cuisine: Mapped[Cuisine] = relationship(back_populates="categories")

    __table_args__ = (
        CheckConstraint(
            "base_calorie_min > 0 AND base_calorie_min <= base_calorie_max",
            name="calorie_range",
        ),
        Index("ix_food_categories_cuisine_id", "cuisine_id"),
        Index("ix_food_categories_name_trgm", text("name gin_trgm_ops"), postgresql_using="gin"),
    )
