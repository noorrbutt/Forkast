"""Calories burned: request and response models."""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Matches ck_burn_logs_calories_plausible. Kept in step with the database on
# purpose: the constraint is the guarantee, this is what turns a typo into a 422
# with a readable message instead of an integrity error surfacing as a 500.
MAX_BURN_CALORIES = 10_000


class BurnUpsert(BaseModel):
    calories: int = Field(ge=0, le=MAX_BURN_CALORIES)
    # Omitted means today, in the user's own timezone. Present so a forgotten
    # day can be filled in later, the same way a meal can be backfilled.
    day: dt.date | None = None

    @field_validator("day")
    @classmethod
    def _bounded_day(cls, value: dt.date | None) -> dt.date | None:
        if value is None:
            return value
        today = dt.date.today()
        if value < today - dt.timedelta(days=3650) or value > today + dt.timedelta(days=1):
            raise ValueError("day must be within the last ten years or tomorrow")
        return value


class BurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    day: dt.date
    calories: int
    updated_at: dt.datetime
