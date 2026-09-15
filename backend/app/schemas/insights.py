"""Dashboard, streaks and AI plan models.

Dashboard and streaks are placeholders in this scaffold. They are served from a
snapshot written by the seed script rather than queried, so every response
carries a `_source` marker. That marker is deliberate: the numbers match the
seeded history and will drift as soon as a new log is added, and the client
shows a "sample data" badge whenever it is present so nobody mistakes the
values for real analytics.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Goal

PLACEHOLDER_SOURCE = "seed-snapshot"


class CaloriesByDay(BaseModel):
    day: dt.date
    calories: int


class BurnEquivalents(BaseModel):
    """Minutes of activity to offset the calories shown.

    Derived from standard MET values for a 70kg adult. Rough by nature: this is
    meant as an intuition pump, not a prescription.
    """

    walking_minutes: int
    running_minutes: int
    cycling_minutes: int


class TopCategory(BaseModel):
    category_id: int
    name: str
    count: int


class TopRestaurant(BaseModel):
    restaurant_id: uuid.UUID | None = None
    name: str
    count: int


class FunMeal(BaseModel):
    dish_name: str
    fun_scale: int
    restaurant_name: str | None = None


class DashboardOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source: str | None = Field(default=PLACEHOLDER_SOURCE, serialization_alias="_source")
    junk_ratio: float
    total_calories: int
    logs_count: int
    calories_by_day: list[CaloriesByDay] = Field(default_factory=list)
    top_category: TopCategory | None = None
    top_restaurant: TopRestaurant | None = None
    best_fun_meals: list[FunMeal] = Field(default_factory=list)
    burn_equivalents: BurnEquivalents


class StreaksOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source: str | None = Field(default=PLACEHOLDER_SOURCE, serialization_alias="_source")
    current_streak: int
    longest_streak: int
    last_junk_date: dt.date | None = None
    # Soft recovery wording rather than a punitive tone, per the product brief.
    message: str


class PlanCreate(BaseModel):
    goal: Goal | None = None


class PlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    goal: Goal
    generated_plan: dict[str, Any]
    model: str | None = None
    created_at: dt.datetime
