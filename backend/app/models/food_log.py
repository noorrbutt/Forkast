"""The core diary entry."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
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
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    estimate_refined_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Grams, from the photo model's own answer -- see PhotoMacros in
    # services/ai/schemas.py. Null for every log that was never priced from a
    # photo; there is no category-derived guess for macros the way there is
    # for calories, so "unknown" has to stay unknown rather than default to 0.
    protein_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1), nullable=True)
    carbs_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1), nullable=True)
    fat_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1), nullable=True)
    # How estimated_calories on THIS row was priced, once, at creation. Not
    # the same thing as EstimateSource ("ai" vs "local", which AI backend is
    # live right now) -- see the migration's own note on the name collision
    # this deliberately avoids. Null for every log made before this column
    # existed: "category" would be a guess about provenance this migration
    # cannot actually confirm.
    calorie_source: Mapped[str | None] = mapped_column(String(16), nullable=True)

    category: Mapped[FoodCategory] = relationship(lazy="joined")
    restaurant: Mapped[Restaurant | None] = relationship(lazy="joined")
    # raise_on_sql, not joined: the bytes must never ride along with a list of
    # logs. The routes that serve an image load it deliberately, and anything
    # that touches this by accident fails loudly instead of quietly shipping
    # megabytes per row.
    photo: Mapped[FoodLogPhoto | None] = relationship(  # noqa: F821
        back_populates="log",
        cascade="all, delete-orphan",
        lazy="raise_on_sql",
        uselist=False,
    )

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
        CheckConstraint("fun_scale IS NULL OR fun_scale BETWEEN 1 AND 5", name="fun_scale_range"),
        CheckConstraint("estimated_calories >= 0", name="calories_non_negative"),
        CheckConstraint(
            "calorie_source IS NULL OR calorie_source IN ('photo', 'category')",
            name="ck_food_logs_calorie_source",
        ),
        CheckConstraint(
            "(protein_g IS NULL OR protein_g >= 0) "
            "AND (carbs_g IS NULL OR carbs_g >= 0) "
            "AND (fat_g IS NULL OR fat_g >= 0)",
            name="ck_food_logs_macros_non_negative",
        ),
        # The dashboard, streak and history queries are all user-scoped and
        # time-ordered; this is the index that serves them.
        Index("ix_food_logs_user_id_created_at", "user_id", text("created_at DESC")),
        Index("ix_food_logs_user_id_category_id", "user_id", "category_id"),
        Index("ix_food_logs_restaurant_id", "restaurant_id"),
        Index(
            "ux_food_logs_user_client_id",
            "user_id",
            "client_id",
            unique=True,
            postgresql_where=text("client_id IS NOT NULL"),
        ),
        Index(
            "ix_food_logs_dish_name_trgm",
            "dish_name",
            postgresql_using="gin",
            postgresql_ops={"dish_name": "gin_trgm_ops"},
        ),
    )
