"""Serving-size multipliers and the clamping rule for calorie estimation.

Order matters and is deliberate:

    category range -> AI adjusts within range -> clamp to [min, max] -> x serving

Clamping happens BEFORE the serving multiplier so the AI's job stays exactly
as constrained as the project plan intends ("nudge within a known range"),
while a large portion can still legitimately exceed the category's nominal max.
"""

from __future__ import annotations

from app.models.enums import ServingSize

SERVING_MULTIPLIERS: dict[ServingSize, float] = {
    ServingSize.small: 0.75,
    ServingSize.medium: 1.0,
    ServingSize.large: 1.4,
}


def clamp_to_range(value: float, minimum: int, maximum: int) -> float:
    return max(float(minimum), min(float(maximum), value))


def apply_serving_size(calories: float, serving_size: ServingSize) -> int:
    return round(calories * SERVING_MULTIPLIERS[serving_size])


def finalise_estimate(
    ai_calories: float, base_min: int, base_max: int, serving_size: ServingSize
) -> int:
    """Clamp the AI's in-range guess, then scale it by the serving size."""
    return apply_serving_size(clamp_to_range(ai_calories, base_min, base_max), serving_size)
