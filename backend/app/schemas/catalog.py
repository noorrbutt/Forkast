"""Cuisines, categories, search and restaurants."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.text import optional_text_field, text_field

# cuisines.id and food_categories.id are smallint. Without this bound an
# oversized id reaches the database and fails as a 500 DataError instead of a
# clean 422.
SMALLINT_MAX = 32767


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
    # float, not Decimal: pydantic serialises a Decimal as a JSON string, and a
    # map needs a number. The column stays Numeric so the stored value is exact.
    latitude: float | None = None
    longitude: float | None = None
    # How many times this user has logged a meal here, counted by the database
    # over their whole history. Only sent for ?mine=true, because on the shared
    # registry the question has no answer: the listing there is every
    # restaurant, not this person's.
    visit_count: int | None = None


class RestaurantCreate(BaseModel):
    name: text_field(max_length=200)
    area: optional_text_field(max_length=120) = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
