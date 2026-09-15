"""Cuisines, categories, search and restaurants."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CuisineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    emoji: str | None = None
    sort_order: int


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cuisine_id: int
    slug: str
    name: str
    base_calorie_min: int
    base_calorie_max: int
    is_junk: bool


class DishSuggestion(BaseModel):
    """A dish the user has logged before, offered back as an autocomplete hit."""

    dish_name: str
    category_id: int


class SearchResults(BaseModel):
    cuisines: list[CuisineOut] = Field(default_factory=list)
    categories: list[CategoryOut] = Field(default_factory=list)
    dishes: list[DishSuggestion] = Field(default_factory=list)


class RestaurantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    area: str | None = None
    latitude: Decimal | None = None
    longitude: Decimal | None = None


class RestaurantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    area: str | None = Field(default=None, max_length=120)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
