"""The contract shared by every AI implementation.

Both the deterministic stub and the real Groq client speak exactly these types,
so swapping one for the other never changes a route signature.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import BiggestStruggle, EatingOutFrequency, Goal, ServingSize


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
    # Self-reported at onboarding, not computed. These shape tone rather than
    # any number in the plan: cravings and "never know what to cook" call for
    # different coaching even at the same junk ratio.
    eating_out_frequency: EatingOutFrequency | None = None
    biggest_struggle: BiggestStruggle | None = None


class PhotoMacros(BaseModel):
    protein_g: float
    carbs_g: float
    fat_g: float


class PortionOption(BaseModel):
    """One plausible serving, offered when the model cannot judge scale.

    A label a person would actually tap, not a gram figure: "small", "medium",
    "large", or something more specific like "one slice" when that reads
    better for the dish. calories is that portion's whole estimate, already
    complete, not a delta from the base guess.
    """

    label: str
    calories: float


class PhotoCalorieEstimate(BaseModel):
    """What a photo alone can tell us, before any category has been chosen.

    Unlike CalorieAdjustResult this is not clamped to a known range -- there is
    no category yet, only a picture -- so `calories` here is a preview meant to
    build trust and let someone catch a wildly wrong guess before they even
    pick a category, not the figure that ends up on the saved log. A log is
    still priced by the existing category-range flow once a category is
    chosen, so nothing here is ever written to food_logs.

    `confidence` and `portion_ambiguous` answer two different questions and
    are never collapsed into one flag: confidence is about recognising the
    dish at all, portion_ambiguous is about judging its scale in this specific
    photo. A photo can be a clear, unmistakable plate of fries shot from
    straight above with nothing in frame to size it against -- confidence
    "high", portion_ambiguous true.
    """

    dish_guess: str
    calories: float
    macros: PhotoMacros
    confidence: Literal["high", "medium", "low"]
    # True only when scale genuinely cannot be judged from the photo -- no
    # hand, utensil, or plate edge to size it against -- never a stand-in for
    # low dish-recognition confidence, which `confidence` already covers.
    portion_ambiguous: bool = False
    # 2 or 3 entries when portion_ambiguous is true, matching the chips the
    # confirm screen shows instead of the single number; empty otherwise.
    # `calories` and `macros` above still carry the model's own best single
    # guess either way, so a caller that ignores this list entirely still gets
    # a usable estimate.
    portion_options: list[PortionOption] = Field(default_factory=list)
    reasoning: str | None = None


class PlanRequest(BaseModel):
    goal: Goal
    timezone: str
    recent_logs: list[PlanLogSummary] = Field(default_factory=list)
    context: PlanContext | None = None


class PlanMeal(BaseModel):
    slot: str
    # Just the dish, e.g. "Grilled salmon with quinoa" -- no instructions.
    # Those belong in `note`, so a client can show them in a smaller, separate
    # line instead of running them into the dish name as one sentence.
    dish: str
    # Optional advice about the dish, e.g. "keep it simple, skip extra sauces".
    note: str | None = None
    approx_calories: int


class PlanDay(BaseModel):
    day: str
    meals: list[PlanMeal]


class PlanResult(BaseModel):
    summary: str
    days: list[PlanDay]
    nudges: list[str]
    model: str | None = None
