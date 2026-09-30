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


# Absolute floor and ceiling for a single meal, regardless of category. A
# photo estimate answering in the tens or the tens of thousands is a model
# failure, not a genuinely tiny or enormous meal, and no category's range
# should be trusted to catch that on its own.
_PHOTO_ESTIMATE_FLOOR = 50
_PHOTO_ESTIMATE_CEILING = 5000


def clamp_photo_estimate(calories: float, base_min: int, base_max: int) -> int:
    """Sanity-bound a client-supplied, photo-derived calorie figure.

    Deliberately NOT the same clamp as finalise_estimate. A photo estimate
    already answers for the actual plate in the photo -- the model was asked
    to size the real portion, not to place a dish within its category's
    nominal range -- so re-clamping it to [base_min, base_max] and then
    applying a serving multiplier on top would both discard genuine portion
    information the category range was never meant to carry and double count
    it. What this still has to catch is a wildly wrong guess, so the category
    range still sets the shape of the bound, only widened: half the category
    minimum on the low side, three times the category maximum on the high
    side, both still inside the absolute floor and ceiling above.
    """
    lower = max(_PHOTO_ESTIMATE_FLOOR, round(base_min * 0.4))
    upper = min(_PHOTO_ESTIMATE_CEILING, round(base_max * 3))
    return round(clamp_to_range(calories, lower, upper))
