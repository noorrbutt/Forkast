"""Unit tests for the calorie maths and the deterministic AI stub."""

from __future__ import annotations

import pytest

from app.models.enums import ServingSize
from app.services.ai.fake import DeterministicAIService
from app.services.ai.schemas import CalorieAdjustRequest
from app.services.calories import (
    SERVING_MULTIPLIERS,
    apply_serving_size,
    clamp_to_range,
    finalise_estimate,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(50, 100), (150, 150), (500, 400), (100, 100), (400, 400)],
)
def test_clamping_keeps_a_value_inside_the_range(value: float, expected: float) -> None:
    assert clamp_to_range(value, 100, 400) == expected


def test_serving_multipliers_are_ordered() -> None:
    assert (
        SERVING_MULTIPLIERS[ServingSize.small]
        < SERVING_MULTIPLIERS[ServingSize.medium]
        < SERVING_MULTIPLIERS[ServingSize.large]
    )


def test_a_large_serving_may_exceed_the_category_maximum() -> None:
    """The clamp constrains the AI's guess, not the portion.

    A large biryani genuinely contains more than the category's nominal maximum,
    so clamping after the multiplier would be wrong.
    """
    assert finalise_estimate(400, 100, 400, ServingSize.large) > 400


def test_an_out_of_range_guess_is_pulled_back_before_scaling() -> None:
    # 9000 is clamped to 400 first, then scaled by the medium multiplier of 1.0.
    assert finalise_estimate(9000, 100, 400, ServingSize.medium) == 400


def test_apply_serving_size_rounds_to_a_whole_calorie() -> None:
    assert isinstance(apply_serving_size(333.33, ServingSize.medium), int)


async def test_the_stub_stays_inside_the_category_range() -> None:
    ai = DeterministicAIService()

    for dish in ("chicken alfredo", "aglio e olio", "grilled fish", "anything at all"):
        result = await ai.adjust_calories(
            CalorieAdjustRequest(
                dish_name=dish,
                category_name="Pasta",
                base_calorie_min=500,
                base_calorie_max=900,
                serving_size=ServingSize.medium,
            )
        )
        assert 500 <= result.calories <= 900, dish


async def test_the_stub_is_deterministic() -> None:
    ai = DeterministicAIService()
    request = CalorieAdjustRequest(
        dish_name="chicken alfredo",
        category_name="Pasta",
        base_calorie_min=500,
        base_calorie_max=900,
        serving_size=ServingSize.medium,
    )

    first = await ai.adjust_calories(request)
    second = await ai.adjust_calories(request)

    assert first.calories == second.calories


async def test_the_stub_skews_rich_dishes_higher_than_light_ones() -> None:
    """Not a real model, but it should at least behave like one."""
    ai = DeterministicAIService()

    def request(dish: str) -> CalorieAdjustRequest:
        return CalorieAdjustRequest(
            dish_name=dish,
            category_name="Pasta",
            base_calorie_min=500,
            base_calorie_max=900,
            serving_size=ServingSize.medium,
        )

    creamy = await ai.adjust_calories(request("creamy alfredo"))
    grilled = await ai.adjust_calories(request("grilled vegetable pasta"))

    assert creamy.calories > grilled.calories


async def test_the_deterministic_stub_and_the_groq_client_are_interchangeable() -> None:
    """The seam only pays off if both sides really satisfy the same Protocol.

    This used to assert the Groq class raised NotImplementedError. It is
    implemented now, so the thing worth guarding is that it still matches the
    interface the routes depend on.
    """
    from app.services.ai.base import AIService
    from app.services.ai.groq_service import GroqAIService

    stub = DeterministicAIService()
    real = GroqAIService(client=None, model="openai/gpt-oss-20b")

    assert isinstance(stub, AIService)
    assert isinstance(real, AIService)
