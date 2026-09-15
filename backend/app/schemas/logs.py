"""Food log request/response models."""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import FriendScale, ServingSize
from app.schemas.catalog import SMALLINT_MAX, CategoryOut, RestaurantOut


class FoodLogCreate(BaseModel):
    dish_name: str = Field(min_length=1, max_length=200)
    category_id: int = Field(ge=1, le=SMALLINT_MAX)

    # Either point at an existing restaurant or give a name and let the server
    # dedupe it into the registry. Both may be omitted: a home cooked meal
    # should never be blocked from being logged.
    restaurant_id: uuid.UUID | None = None
    restaurant_name: str | None = Field(default=None, max_length=200)
    area: str | None = Field(default=None, max_length=120)

    rating: int = Field(ge=1, le=5)
    fun_scale: int | None = Field(default=None, ge=1, le=5)
    friend_scale: FriendScale | None = None
    serving_size: ServingSize = ServingSize.medium

    # Optional, for backfilling older meals. Defaults to now on the server.
    created_at: dt.datetime | None = None

    @model_validator(mode="after")
    def _one_restaurant_reference(self) -> FoodLogCreate:
        if self.restaurant_id is not None and self.restaurant_name:
            raise ValueError("Pass restaurant_id or restaurant_name, not both")
        return self


class FoodLogUpdate(BaseModel):
    dish_name: str | None = Field(default=None, min_length=1, max_length=200)
    category_id: int | None = Field(default=None, ge=1, le=SMALLINT_MAX)
    restaurant_id: uuid.UUID | None = None
    area: str | None = Field(default=None, max_length=120)
    rating: int | None = Field(default=None, ge=1, le=5)
    fun_scale: int | None = Field(default=None, ge=1, le=5)
    friend_scale: FriendScale | None = None
    serving_size: ServingSize | None = None


class FoodLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dish_name: str
    category_id: int
    restaurant_id: uuid.UUID | None = None
    area: str | None = None
    rating: int
    fun_scale: int | None = None
    friend_scale: FriendScale | None = None
    serving_size: ServingSize
    estimated_calories: int
    created_at: dt.datetime

    # Joined in so the client can render a log row without a second request.
    category: CategoryOut | None = None
    restaurant: RestaurantOut | None = None


class FoodLogPage(BaseModel):
    items: list[FoodLogOut]
    total: int
