"""The core diary entry."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_uuid7, str_enum
from app.models.enums import FriendScale, ServingSize
from app.models.reference import FoodCategory
from app.models.restaurant import Restaurant


class FoodLog(Base):
    __tablename__ = "food_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    dish_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("food_categories.id", ondelete="RESTRICT"), nullable=False
    )
    restaurant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("restaurants.id", ondelete="SET NULL")
    )
    area: Mapped[str | None] = mapped_column(String(120))

    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    fun_scale: Mapped[int | None] = mapped_column(SmallInteger)
    friend_scale: Mapped[FriendScale | None] = mapped_column(
        str_enum(FriendScale, "friend_scale", length=16)
    )

    serving_size: Mapped[ServingSize] = mapped_column(
        str_enum(ServingSize, "serving_size", length=16), nullable=False
    )
    estimated_calories: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    category: Mapped[FoodCategory] = relationship(lazy="joined")
    restaurant: Mapped[Restaurant | None] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
        CheckConstraint("fun_scale IS NULL OR fun_scale BETWEEN 1 AND 5", name="fun_scale_range"),
        CheckConstraint("estimated_calories >= 0", name="calories_non_negative"),
        # The dashboard, streak and history queries are all user-scoped and
        # time-ordered; this is the index that serves them.
        Index("ix_food_logs_user_id_created_at", "user_id", text("created_at DESC")),
        Index("ix_food_logs_user_id_category_id", "user_id", "category_id"),
        Index("ix_food_logs_restaurant_id", "restaurant_id"),
        Index(
            "ix_food_logs_dish_name_trgm",
            "dish_name",
            postgresql_using="gin",
            postgresql_ops={"dish_name": "gin_trgm_ops"},
        ),
    )
