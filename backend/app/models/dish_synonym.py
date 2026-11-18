"""Canonical dish names and searchable language aliases."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DishSynonym(Base):
    __tablename__ = "dish_synonyms"

    alias: Mapped[str] = mapped_column(String(100), primary_key=True)
    dish_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("food_categories.id", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        Index(
            "ix_dish_synonyms_alias_trgm",
            "alias",
            postgresql_using="gin",
            postgresql_ops={"alias": "gin_trgm_ops"},
        ),
    )
