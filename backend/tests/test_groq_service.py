"""The real Groq implementation, exercised without a key or a network call.

The client is injected, so these tests drive the same code path production uses
and only replace the transport. That covers everything except whether Groq
itself behaves as documented, which no local test can tell us.
"""

from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

import pytest

from app.models.enums import Goal, ServingSize
from app.services.ai.groq_service import (
    CALORIE_SCHEMA,
    PLAN_SCHEMA,
    GroqAIService,
    GroqResponseError,
)
from app.services.ai.schemas import (
    CalorieAdjustRequest,
    PlanLogSummary,
    PlanRequest,
)

MODEL = "openai/gpt-oss-20b"


class _FakeCompletions:
    def __init__(self, content: str | None = None, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


class _FakeClient:
    def __init__(self, content: str | None = None, error: Exception | None = None) -> None:
        self.completions = _FakeCompletions(content, error)
        self.chat = SimpleNamespace(completions=self.completions)


def _calorie_request(low: int = 600, high: int = 950) -> CalorieAdjustRequest:
    return CalorieAdjustRequest(
        dish_name="chicken biryani",
        category_name="Biryani",
        base_calorie_min=low,
        base_calorie_max=high,
        serving_size=ServingSize.medium,
    )


def _plan_request() -> PlanRequest:
    return PlanRequest(
        goal=Goal.cut,
        timezone="Asia/Karachi",
        recent_logs=[
            PlanLogSummary(
                dish_name="pepperoni pizza",
                category_name="Pizza",
                cuisine_name="Italian",
                is_junk=True,
                estimated_calories=900,
                logged_at=dt.datetime(2026, 9, 14, 20, 0, tzinfo=dt.UTC),
            )
        ],
    )


async def test_the_request_uses_the_shape_groq_actually_expects() -> None:
    """These four are the ones that are wrong in most example code."""
    client = _FakeClient(json.dumps({"calories": 700, "reasoning": "rice and oil"}))
    service = GroqAIService(client, model=MODEL)

    await service.adjust_calories(_calorie_request())

    sent = client.completions.calls[0]
    assert sent["model"] == MODEL
    assert "max_completion_tokens" in sent, "max_tokens is the legacy alias"
    assert "max_tokens" not in sent
    assert sent["response_format"]["type"] == "json_schema"
    assert sent["response_format"]["json_schema"]["strict"] is True


async def test_a_retired_model_is_not_hardcoded() -> None:
    """llama-3.3-70b-versatile and llama-3.1-8b-instant were shut down on
    2026-08-16 while still listed on the models page."""
    from app.config import get_settings

    assert "llama" not in get_settings().groq_model


async def test_the_calorie_reply_is_parsed() -> None:
    client = _FakeClient(json.dumps({"calories": 812, "reasoning": "heavy on ghee"}))
    service = GroqAIService(client, model=MODEL)

    result = await service.adjust_calories(_calorie_request())

    assert result.calories == 812
    assert result.reasoning == "heavy on ghee"


@pytest.mark.parametrize(
    ("returned", "expected"),
    [(5000, 950), (10, 600), (700, 700)],
    ids=["above the range", "below the range", "inside the range"],
)
async def test_a_reply_outside_the_range_is_clamped(returned: int, expected: int) -> None:
    """A strict schema constrains the shape of the reply, never the number in
    it, so the model can and will answer outside the range it was given."""
    client = _FakeClient(json.dumps({"calories": returned, "reasoning": "x"}))
    service = GroqAIService(client, model=MODEL)

    result = await service.adjust_calories(_calorie_request())

    assert result.calories == expected


async def test_the_plan_reply_is_parsed_and_tagged_with_the_model() -> None:
    client = _FakeClient(
        json.dumps(
            {
                "summary": "Lighter lunches, same dinners.",
                "days": [
                    {
                        "day": "Monday",
                        "meals": [
                            {"slot": "Lunch", "suggestion": "Grilled boti", "approx_calories": 600}
                        ],
                    }
                ],
                "nudges": ["Pizza four times this week."],
            }
        )
    )
    service = GroqAIService(client, model=MODEL)

    result = await service.generate_plan(_plan_request())

    assert result.summary.startswith("Lighter")
    assert result.days[0].meals[0].approx_calories == 600
    assert result.nudges == ["Pizza four times this week."]
    assert result.model == MODEL


async def test_the_prompt_carries_the_range_and_the_history() -> None:
    client = _FakeClient(json.dumps({"calories": 700, "reasoning": "x"}))
    service = GroqAIService(client, model=MODEL)
    await service.adjust_calories(_calorie_request(600, 950))
    calorie_prompt = client.completions.calls[0]["messages"][1]["content"]

    assert "600" in calorie_prompt and "950" in calorie_prompt
    assert "chicken biryani" in calorie_prompt

    planner = _FakeClient(json.dumps({"summary": "s", "days": [], "nudges": []}))
    await GroqAIService(planner, model=MODEL).generate_plan(_plan_request())
    plan_prompt = planner.completions.calls[0]["messages"][1]["content"]

    assert "cut" in plan_prompt
    assert "pepperoni pizza" in plan_prompt
    assert "junk" in plan_prompt


async def test_a_transport_failure_becomes_one_exception_type() -> None:
    """The routes should not have to know what Groq is to return a status code."""
    client = _FakeClient(error=TimeoutError("connection timed out"))
    service = GroqAIService(client, model=MODEL)

    with pytest.raises(GroqResponseError, match="Groq request failed"):
        await service.adjust_calories(_calorie_request())


@pytest.mark.parametrize(
    "content",
    ["", "not json at all", '{"reasoning": "no number"}'],
    ids=["empty", "not json", "missing the field"],
)
async def test_an_unusable_reply_is_reported_clearly(content: str) -> None:
    service = GroqAIService(_FakeClient(content), model=MODEL)

    with pytest.raises(GroqResponseError):
        await service.adjust_calories(_calorie_request())


async def test_a_plan_of_the_wrong_shape_is_rejected() -> None:
    service = GroqAIService(_FakeClient(json.dumps({"summary": "only this"})), model=MODEL)

    with pytest.raises(GroqResponseError, match="did not match"):
        await service.generate_plan(_plan_request())


def test_the_schemas_are_strict_and_closed() -> None:
    """Without additionalProperties false, strict mode is not actually strict."""
    for schema in (CALORIE_SCHEMA, PLAN_SCHEMA):
        assert schema["strict"] is True
        assert schema["schema"]["additionalProperties"] is False
        assert schema["schema"]["required"]


# --- how a failure looks to the client ---


class _AlwaysFailingAI:
    """Satisfies the Protocol, fails the way a dead upstream does."""

    async def adjust_calories(self, req):
        raise GroqResponseError("Groq request failed: connection timed out")

    async def generate_plan(self, req):
        raise GroqResponseError("Groq request failed: connection timed out")


async def test_a_dead_ai_provider_is_a_502_not_a_500(auth_client) -> None:
    """The provider is upstream of us, so its outage is not our internal error.

    A 500 tells the client to report a bug. A 502 tells it to retry, which is
    the correct advice when the estimator is briefly unavailable.
    """
    from app.main import app
    from app.services.ai.deps import get_ai_service

    app.dependency_overrides[get_ai_service] = lambda: _AlwaysFailingAI()
    try:
        categories = (await auth_client.get("/api/v1/categories")).json()
        log = await auth_client.post(
            "/api/v1/logs",
            json={
                "dish_name": "biryani",
                "category_id": categories[0]["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
        plan = await auth_client.post("/api/v1/plans", json={"goal": "cut"})
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert log.status_code == 502, log.text
    assert plan.status_code == 502, plan.text
    assert "unavailable" in log.json()["detail"]


async def test_a_failed_estimate_does_not_leave_a_half_written_log(auth_client) -> None:
    """The estimate happens before the insert, so a provider outage must leave
    nothing behind rather than a log with no calories."""
    from app.main import app
    from app.services.ai.deps import get_ai_service

    before = (await auth_client.get("/api/v1/logs")).json()["total"]

    app.dependency_overrides[get_ai_service] = lambda: _AlwaysFailingAI()
    try:
        categories = (await auth_client.get("/api/v1/categories")).json()
        await auth_client.post(
            "/api/v1/logs",
            json={
                "dish_name": "ghost",
                "category_id": categories[0]["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert (await auth_client.get("/api/v1/logs")).json()["total"] == before

