"""Dashboard, streaks and AI plan models.

These were served from a seed snapshot while the scaffold was being built, and
every response carried a `_source` marker so the client could badge them as
sample data. Both are computed from food_logs now, so the marker and the badge
are gone rather than left behind as a field that is permanently null.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Goal
from app.services.ai.deps import EstimateSource


class CaloriesByDay(BaseModel):
    day: dt.date
    calories: int
    # How much of that day's total came from junk flagged categories. The chart
    # stacks it under the rest, so a day reads as its shape rather than only its
    # height: two days can total the same and be nothing alike.
    junk_calories: int = 0
    # What the user said they burned that day. Zero when nothing was entered,
    # which the chart draws the same way as a deliberate zero.
    burned: int = 0


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


class TodayOut(BaseModel):
    """Today alone, measured against the target if there is one.

    Separate from the 14 day totals because a progress bar is a statement about
    today and nothing else. Reading it off the end of calories_by_day would
    work until the chart window or its ordering changed.
    """

    target: int | None = None
    consumed: int = 0
    burned: int = 0
    net: int = 0
    # Null when no target is set, and allowed to go negative when one is and the
    # day went over. Clamping would hide the thing the user most wants to know.
    remaining: int | None = None


class DashboardOut(BaseModel):
    junk_ratio: float
    total_calories: int
    # Calories in, out, and the difference. net is computed rather than left to
    # the client so every surface shows the same number, and it is allowed to go
    # negative: a long walk on a light day is a real outcome, not an error.
    total_burned: int = 0
    net_calories: int = 0
    logs_count: int
    today: TodayOut = Field(default_factory=TodayOut)
    calories_by_day: list[CaloriesByDay] = Field(default_factory=list)
    top_category: TopCategory | None = None
    top_restaurant: TopRestaurant | None = None
    best_fun_meals: list[FunMeal] = Field(default_factory=list)
    burn_equivalents: BurnEquivalents


class StreaksOut(BaseModel):
    current_streak: int
    longest_streak: int
    last_junk_date: dt.date | None = None
    # What actually broke it. The date on its own says a run ended and leaves
    # the reader to work out which meal did it, which is the one thing they
    # would want to know and the only part that is actionable. Null whenever
    # last_junk_date is null, and null if the meal has since been deleted.
    last_junk_dish: str | None = None
    # Soft recovery wording rather than a punitive tone, per the product brief.
    message: str


class TrendPeriod(BaseModel):
    """One calendar month, bucketed into the user's own local days."""

    # The first of the month, local. The client titles the column from this
    # rather than from its own clock, which can sit in a different zone.
    month: dt.date
    total_calories: int
    meals_logged: int
    junk_ratio: float
    avg_calories_per_day: float
    # The denominator behind the average. The current month counts only the
    # days that have actually happened, so this is not always the length of the
    # month and the client must not assume it is.
    days_counted: int


class TrendChange(BaseModel):
    """This month minus last month, per metric.

    Computed here so every surface shows the same arrow. A client subtracting
    two already rounded figures can land a whole unit away from this.
    """

    total_calories: int
    meals_logged: int
    junk_ratio: float
    avg_calories_per_day: float


class TrendOut(BaseModel):
    this_month: TrendPeriod
    last_month: TrendPeriod
    change: TrendChange


class PlanCreate(BaseModel):
    goal: Goal | None = None


class PlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    goal: Goal
    generated_plan: dict[str, Any]
    estimate_source: EstimateSource = "local"
    model: str | None = None
    created_at: dt.datetime
