"""Deterministic stand-in for the AI, used until Groq is wired up.

Deterministic, not random: the same dish always produces the same number, so
seed data, snapshot tests and demo screenshots stay stable across runs.
"""

from __future__ import annotations

import hashlib
from typing import Literal

from app.services.ai.schemas import (
    CalorieAdjustRequest,
    CalorieAdjustResult,
    PhotoCalorieEstimate,
    PhotoMacros,
    PlanDay,
    PlanMeal,
    PlanRequest,
    PlanResult,
    PortionOption,
)

# Dish guesses the fake vision path cycles through. It cannot actually see the
# photo, so the point is only that it behaves like something that produces a
# named dish and a plausible number, never that the name matches the picture.
_PHOTO_DISH_GUESSES = (
    "chicken biryani",
    "grilled chicken with rice",
    "cheese pizza slice",
    "garden salad",
    "beef burger with fries",
    "daal chawal",
)
_PHOTO_CONFIDENCES: tuple[Literal["high", "medium", "low"], ...] = ("high", "medium", "low")

# Words that genuinely move a dish within its category's range. This table is
# throwaway: it exists so the stub visibly behaves like the model it stands in
# for, and it goes away when GroqAIService lands.
_HEAVY = (
    "cream",
    "creamy",
    "alfredo",
    "cheese",
    "cheesy",
    "fried",
    "butter",
    "makhani",
    "korma",
    "malai",
    "loaded",
    "double",
    "stuffed",
    "mayo",
    "white sauce",
)
_LIGHT = (
    "grilled",
    "steamed",
    "soup",
    "salad",
    "broth",
    "boiled",
    "roasted",
    "tandoori",
    "clear",
    "light",
    "lemon",
    "veg",
    "vegetable",
)


def _stable_unit_interval(*parts: str) -> float:
    """A stable pseudo-random float in [0, 1) derived from the inputs."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


class DeterministicAIService:
    """Implements AIService without any network call."""

    async def adjust_calories(self, req: CalorieAdjustRequest) -> CalorieAdjustResult:
        low, high = float(req.base_calorie_min), float(req.base_calorie_max)
        midpoint = (low + high) / 2
        half_span = (high - low) / 2

        dish = req.dish_name.lower()
        if any(word in dish for word in _HEAVY):
            bias, why = 0.55, "rich preparation, skewed high in range"
        elif any(word in dish for word in _LIGHT):
            bias, why = -0.55, "light preparation, skewed low in range"
        else:
            bias, why = 0.0, "no strong signal in the dish name, near midpoint"

        # A small stable wobble so two dishes in the same bucket do not collide
        # on an identical number.
        jitter = (_stable_unit_interval(dish, req.category_name) * 2 - 1) * 0.25
        calories = midpoint + half_span * max(-1.0, min(1.0, bias + jitter))

        return CalorieAdjustResult(
            calories=max(low, min(high, calories)),
            reasoning=f"[stub] {why}",
        )

    async def estimate_from_photo(self, image: bytes, content_type: str) -> PhotoCalorieEstimate:
        """Stands in for the vision model without looking at the bytes at all.

        Deterministic on the image content, the same reasoning as
        adjust_calories: the same photo submitted twice should not produce two
        different guesses, since that would read as a flaky estimator rather
        than a stub. content_type is accepted and ignored, matching the real
        method's signature exactly.
        """
        digest = hashlib.sha256(image).hexdigest()
        dish_guess = _PHOTO_DISH_GUESSES[int(digest[0:8], 16) % len(_PHOTO_DISH_GUESSES)]
        confidence = _PHOTO_CONFIDENCES[int(digest[8:16], 16) % len(_PHOTO_CONFIDENCES)]
        # A plausible single-serving range, picked the same way
        # _stable_unit_interval biases a dish within its category range.
        calories = 350.0 + _stable_unit_interval(digest) * 550.0

        # A separate slice of the hash, deliberately: portion ambiguity is not
        # tied to confidence (see PhotoCalorieEstimate's own docstring on the
        # two being different questions), so a "high confidence, ambiguous
        # portion" photo has to be reachable in tests without also forcing low
        # dish confidence. Roughly a third of photos land here, enough for the
        # mobile chip path to be exercised without it dominating the fixture.
        portion_ambiguous = int(digest[16:24], 16) % 3 == 0
        portion_options: list[PortionOption] = []
        if portion_ambiguous:
            portion_options = [
                PortionOption(label="small", calories=round(calories * 0.65)),
                PortionOption(label="medium", calories=round(calories)),
                PortionOption(label="large", calories=round(calories * 1.4)),
            ]

        return PhotoCalorieEstimate(
            dish_guess=dish_guess,
            calories=round(calories),
            macros=PhotoMacros(
                protein_g=round(calories * 0.20 / 4, 1),
                carbs_g=round(calories * 0.50 / 4, 1),
                fat_g=round(calories * 0.30 / 9, 1),
            ),
            confidence=confidence,
            portion_ambiguous=portion_ambiguous,
            portion_options=portion_options,
            reasoning="[stub] deterministic photo estimate, no vision model called",
        )

    async def generate_plan(self, req: PlanRequest) -> PlanResult:
        goal_line = {
            "cut": "leaning lighter, without making food boring",
            "maintain": "keeping things roughly where they are",
            "bulk": "eating a bit more, with the calories actually counting",
        }[req.goal.value]

        total = len(req.recent_logs)
        junk_count = sum(1 for log in req.recent_logs if log.is_junk)

        counts: dict[str, int] = {}
        for log in req.recent_logs:
            counts[log.category_name] = counts.get(log.category_name, 0) + 1
        repeated = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:2]

        nudges: list[str] = []
        for name, count in repeated:
            if count >= 3:
                nudges.append(f"You have had {name.lower()} {count} times recently.")
        if total:
            verdict = "Nicely balanced." if junk_count * 2 < total else "Worth a couple of swaps."
            nudges.append(f"{junk_count} of your last {total} logs were junk-flagged. {verdict}")
        nudges.append("Logging right after you eat keeps the estimates honest.")

        days = [
            PlanDay(
                day=day,
                meals=[
                    PlanMeal(
                        slot="Breakfast",
                        suggestion="Eggs with one paratha swapped for toast",
                        approx_calories=420,
                    ),
                    PlanMeal(
                        slot="Lunch",
                        suggestion="Grilled chicken with rice and salad",
                        approx_calories=650,
                    ),
                    PlanMeal(
                        slot="Dinner",
                        suggestion="Daal chawal with a side of yoghurt",
                        approx_calories=550,
                    ),
                ],
            )
            for day in ("Monday", "Tuesday", "Wednesday")
        ]

        return PlanResult(
            summary=(
                f"[stub plan] Built from your last {total} logs, {goal_line}. "
                "Switch AI_PROVIDER from fake to groq for a real plan."
            ),
            days=days,
            nudges=nudges[:4],
            model="stub",
        )
