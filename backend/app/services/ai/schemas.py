"""The contract shared by every AI implementation.

Both the deterministic stub and the real Groq client speak exactly these types,
so swapping one for the other never changes a route signature.
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field

from app.models.enums import Goal, ServingSize


class CalorieAdjustRequest(BaseModel):
    dish_name: str
    category_name: str
    base_calorie_min: int
    base_calorie_max: int
    serving_size: ServingSize


class CalorieAdjustResult(BaseModel):
    """`calories` is the in-range figure BEFORE the serving multiplier.

    Keeping the multiplier out of the AI's job is the whole point of the
    category-range approach: the model only ever nudges within a known range.
    """

    calories: float
    reasoning: str | None = None


class PlanLogSummary(BaseModel):
    """One recent log, flattened into what the planner actually needs."""

    dish_name: str
    category_name: str
    cuisine_name: str
    is_junk: bool
    estimated_calories: int
    logged_at: dt.datetime


class PlanContext(BaseModel):
    """The figures the app has already worked out for this user.

    Without these the model is handed a pile of raw logs and left to count for
    itself, so its summary can say "you have been good this week" while the
    dashboard two taps away shows a junk ratio of 60 percent. Same user, same
    moment, two different stories. These are the dashboard's own numbers, so
    the plan can only agree with it.
    """

    window_days: int
    logs_count: int
    total_calories: int
    total_burned: int
    net_calories: int
    junk_ratio: float
    avg_calories_per_day: int
    current_streak: int
    longest_streak: int
    top_category: str | None = None


class PlanRequest(BaseModel):
    goal: Goal
    timezone: str
    recent_logs: list[PlanLogSummary] = Field(default_factory=list)
    context: PlanContext | None = None


class PlanMeal(BaseModel):
    slot: str
    suggestion: str
    approx_calories: int


class PlanDay(BaseModel):
    day: str
    meals: list[PlanMeal]


class PlanResult(BaseModel):
    summary: str
    days: list[PlanDay]
    nudges: list[str]
    model: str | None = None
