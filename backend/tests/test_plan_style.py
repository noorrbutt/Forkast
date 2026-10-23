"""The optional `style` field on POST /plans.

An old client never sends `style` at all, so the default has to be exactly
what every existing plan already looks like: "standard", breakfast/lunch/
dinner, the same prompt wording as before. "ramadan" is new ground: sehri,
iftar and a late meal, with its own instruction appended to the prompt the
model sees. Both styles still clamp calories by category the same way, since
nothing about that logic depends on style.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.main import app
from app.models.enums import Goal
from app.services.ai.deps import get_ai_service
from app.services.ai.fake import DeterministicAIService
from app.services.ai.groq_service import _plan_prompt
from app.services.ai.schemas import PlanRequest, PlanResult


class _CapturingAI:
    def __init__(self) -> None:
        self.seen: PlanRequest | None = None
        self._real = DeterministicAIService()

    async def adjust_calories(self, req):
        return await self._real.adjust_calories(req)

    async def generate_plan(self, req: PlanRequest) -> PlanResult:
        self.seen = req
        return PlanResult(summary="ok", days=[], nudges=[], model="test")


@pytest.fixture
def capture():
    spy = _CapturingAI()
    app.dependency_overrides[get_ai_service] = lambda: spy
    yield spy
    app.dependency_overrides.pop(get_ai_service, None)


async def test_an_old_client_sending_no_style_gets_standard(
    auth_client: AsyncClient, capture: _CapturingAI
) -> None:
    response = await auth_client.post("/api/v1/plans", json={"goal": "cut"})
    assert response.status_code == 201, response.text
    assert capture.seen.style == "standard"


async def test_style_ramadan_reaches_the_planner(
    auth_client: AsyncClient, capture: _CapturingAI
) -> None:
    response = await auth_client.post("/api/v1/plans", json={"goal": "cut", "style": "ramadan"})
    assert response.status_code == 201, response.text
    assert capture.seen.style == "ramadan"


async def test_an_unknown_style_is_rejected_rather_than_silently_accepted(
    auth_client: AsyncClient,
) -> None:
    response = await auth_client.post("/api/v1/plans", json={"goal": "cut", "style": "eid"})
    assert response.status_code == 422


def test_the_standard_prompt_is_unchanged_by_the_new_field() -> None:
    """A standard-style request has to produce exactly the prompt a client
    from before this field existed already relies on."""
    prompt = _plan_prompt(
        PlanRequest(goal=Goal.maintain, timezone="Asia/Karachi", recent_logs=[], context=None)
    )
    assert "Sehri" not in prompt
    assert "Iftar" not in prompt
    assert "This plan is for Ramadan" not in prompt


def test_the_ramadan_prompt_names_sehri_iftar_and_late() -> None:
    prompt = _plan_prompt(
        PlanRequest(
            goal=Goal.maintain,
            timezone="Asia/Karachi",
            recent_logs=[],
            context=None,
            style="ramadan",
        )
    )
    assert "This plan is for Ramadan" in prompt
    assert "Sehri" in prompt
    assert "Iftar" in prompt
    assert "dates and water" in prompt
    assert "Late" in prompt


async def test_fake_provider_standard_style_uses_the_old_three_slots() -> None:
    result = await DeterministicAIService().generate_plan(
        PlanRequest(goal=Goal.maintain, timezone="Asia/Karachi", recent_logs=[], context=None)
    )
    slots = {meal.slot for day in result.days for meal in day.meals}
    assert slots == {"Breakfast", "Lunch", "Dinner"}


async def test_fake_provider_ramadan_style_uses_sehri_iftar_late() -> None:
    result = await DeterministicAIService().generate_plan(
        PlanRequest(
            goal=Goal.maintain,
            timezone="Asia/Karachi",
            recent_logs=[],
            context=None,
            style="ramadan",
        )
    )
    slots = {meal.slot for day in result.days for meal in day.meals}
    assert slots == {"Sehri", "Iftar", "Late"}


async def test_a_standard_plan_request_behaves_exactly_as_before(
    auth_client: AsyncClient,
) -> None:
    """The acceptance bar: nothing about the standard path changed."""
    response = await auth_client.post("/api/v1/plans", json={"goal": "cut"})
    assert response.status_code == 201, response.text
    body = response.json()
    slots = {meal["slot"] for day in body["generated_plan"]["days"] for meal in day["meals"]}
    assert slots == {"Breakfast", "Lunch", "Dinner"}
    assert body["generated_plan"]["style"] == "standard"
