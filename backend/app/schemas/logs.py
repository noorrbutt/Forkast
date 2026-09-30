"""Food log request/response models."""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import FriendScale, ServingSize
from app.schemas.catalog import SMALLINT_MAX, CategoryOut, RestaurantOut
from app.schemas.text import optional_text_field, text_field
from app.services.ai.deps import EstimateSource


class FoodLogCreate(BaseModel):
    dish_name: text_field(max_length=200)
    category_id: int = Field(ge=1, le=SMALLINT_MAX)

    # Either point at an existing restaurant or give a name and let the server
    # dedupe it into the registry. Both may be omitted: a home cooked meal
    # should never be blocked from being logged.
    restaurant_id: uuid.UUID | None = None
    restaurant_name: optional_text_field(max_length=200) = None
    area: optional_text_field(max_length=120) = None

    rating: int = Field(ge=1, le=5)
    fun_scale: int | None = Field(default=None, ge=1, le=5)
    friend_scale: FriendScale | None = None
    serving_size: ServingSize = ServingSize.medium
    client_id: uuid.UUID | None = None

    # The number the confirm screen actually showed, from POST
    # /logs/estimate-photo, so the log this becomes carries the figure that
    # was approved rather than a second, category-derived number nobody
    # confirmed. Bounds are loose on purpose: create_log clamps this against
    # the chosen category's own range (see clamp_photo_estimate), not here,
    # since only the route knows which category was picked. Absent means
    # "price this from the category" exactly as before -- no photo estimate,
    # no change in behaviour.
    estimated_calories: int | None = Field(default=None, gt=0, le=20_000)
    protein_g: float | None = Field(default=None, ge=0, le=1000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    fat_g: float | None = Field(default=None, ge=0, le=1000)

    # Optional, for backfilling older meals. Defaults to now on the server.
    created_at: dt.datetime | None = None

    @field_validator("created_at")
    @classmethod
    def _bounded_and_offset_aware(cls, value: dt.datetime | None) -> dt.datetime | None:
        """Require an offset and a plausible instant.

        A naive datetime is not harmless here. asyncpg encodes it with
        astimezone, which reads it as the API host's local zone rather than the
        user's, so the same payload lands on a different calendar day depending
        on where the server runs. Streaks bucket by local day, so that is a
        wrong answer in a feature that looks unrelated.
        """
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(
                "created_at must include a UTC offset, for example 2026-09-16T20:30:00+05:00"
            )

        now = dt.datetime.now(dt.UTC)
        if value > now + CLOCK_SKEW:
            raise ValueError("created_at cannot be in the future")
        if value < now - MAX_BACKFILL:
            raise ValueError("created_at is implausibly far in the past")
        return value

    @model_validator(mode="after")
    def _one_restaurant_reference(self) -> FoodLogCreate:
        if self.restaurant_id is not None and self.restaurant_name:
            raise ValueError("Pass restaurant_id or restaurant_name, not both")
        return self

    @model_validator(mode="after")
    def _macros_need_a_calorie_figure(self) -> FoodLogCreate:
        """A macro without the calorie figure it came from is not a fact
        worth storing -- it has nowhere to be clamped against and no source
        to be labelled with, so refuse it rather than accept an orphaned
        number the app can never explain to whoever reads it back."""
        macro_fields = ("protein_g", "carbs_g", "fat_g")
        if self.estimated_calories is None and any(
            getattr(self, field) is not None for field in macro_fields
        ):
            raise ValueError("protein_g, carbs_g and fat_g need estimated_calories alongside them")
        return self


# A backfill is for a meal someone forgot to log, so it may sit slightly ahead
# of the server clock but never genuinely in the future, and never prehistoric.
CLOCK_SKEW = dt.timedelta(minutes=5)
MAX_BACKFILL = dt.timedelta(days=3650)

# Columns the database declares NOT NULL. Omitting them in a PATCH means "leave
# alone", but sending an explicit null is a client mistake and has to be a 422
# rather than an integrity error surfacing as a 500.
NON_NULLABLE_FIELDS = frozenset({"dish_name", "category_id", "rating", "serving_size"})


class FoodLogUpdate(BaseModel):
    # Required-shaped rather than optional-shaped: blanking a dish name has to
    # read as a length error, and _reject_explicit_nulls below turns an
    # explicit null into a 422. area is genuinely nullable, so there a blank
    # does mean "clear it".
    dish_name: text_field(max_length=200) | None = None
    category_id: int | None = Field(default=None, ge=1, le=SMALLINT_MAX)
    restaurant_id: uuid.UUID | None = None
    area: optional_text_field(max_length=120) = None
    rating: int | None = Field(default=None, ge=1, le=5)
    fun_scale: int | None = Field(default=None, ge=1, le=5)
    friend_scale: FriendScale | None = None
    serving_size: ServingSize | None = None

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> FoodLogUpdate:
        nulled = sorted(
            name
            for name in self.model_fields_set & NON_NULLABLE_FIELDS
            if getattr(self, name) is None
        )
        if nulled:
            raise ValueError(f"these fields cannot be set to null: {', '.join(nulled)}")
        return self


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
    estimate_source: EstimateSource = "local"
    # How THIS row's estimated_calories was priced, once, at creation --
    # "photo" or "category", null for a log made before this column existed.
    # Not the same field as estimate_source above: that one says which AI
    # backend answered this request just now, this one says where the
    # number on the row itself came from.
    calorie_source: str | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    # True once estimated_calories stopped being provisional -- either a
    # photo priced it directly at creation, or the background text refinement
    # landed. The client uses this to show a small "Refined" tag on the one
    # render where the number changes, instead of a silent swap.
    refined: bool = False
    # Computed by the database as part of the same SELECT, so a list of logs
    # never loads a byte of image data to answer it.
    has_photo: bool = False
    created_at: dt.datetime

    # Joined in so the client can render a log row without a second request.
    category: CategoryOut | None = None
    restaurant: RestaurantOut | None = None


class FoodLogPage(BaseModel):
    items: list[FoodLogOut]
    total: int
