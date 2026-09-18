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
    normalise_text,
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
    the correct advice when the planner is briefly unavailable.

    Only the planner is checked here now. Logging a meal used to sit behind the
    estimator and answer 502 the same way, and that was the wrong trade: it made
    someone else's outage take away the one action the app exists for. A meal is
    saved immediately with the category midpoint and refined afterwards, so
    there is no longer a status code for the estimator being down, because the
    user is not waiting on it. See tests/test_saving_does_not_wait.py.
    """
    from app.main import app
    from app.services.ai.deps import get_ai_service

    app.dependency_overrides[get_ai_service] = lambda: _AlwaysFailingAI()
    try:
        plan = await auth_client.post("/api/v1/plans", json={"goal": "cut"})
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert plan.status_code == 502, plan.text
    assert "unavailable" in plan.json()["detail"]


async def test_a_dead_ai_provider_does_not_stop_a_meal_being_logged(auth_client) -> None:
    """The inverse of the test above, and the reason it shrank.

    A meal someone took the trouble to type in is not lost because a third party
    is rate limiting us. The row is written with a defensible figure and the
    model's refinement is applied behind the response, or not at all.
    """
    from app.main import app
    from app.services.ai.deps import get_ai_service

    before = (await auth_client.get("/api/v1/logs")).json()["total"]

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
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert log.status_code == 201, log.text
    assert log.json()["estimated_calories"] > 0
    assert (await auth_client.get("/api/v1/logs")).json()["total"] == before + 1


# --- typography ---
#
# Not a style nit. On the first live run the model produced em dashes in four of
# five nudges, and that text is stored and shown to the user.


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("pizza this week\u2014maybe try veggie", "pizza this week, maybe try veggie"),
        ("a three\u2011day menu", "a three-day menu"),
        ("You\u2019re cutting", "You're cutting"),
        ("lemon\u2011olive oil", "lemon-olive oil"),
        ("nothing to change here", "nothing to change here"),
        ("spaced \u2014 dash", "spaced, dash"),
    ],
)
def test_the_models_typography_is_rewritten(raw: str, expected: str) -> None:
    assert normalise_text(raw) == expected


def test_nothing_above_the_ascii_punctuation_range_survives() -> None:
    messy = "love\u2014pizza, three\u2011day, \u201cquoted\u201d, it\u2019s\u2026 done\u00a0now"
    cleaned = normalise_text(messy)
    assert not [c for c in cleaned if ord(c) > 0x2000], cleaned


async def test_a_plan_is_cleaned_before_it_is_stored() -> None:
    """Every string the user reads goes through the filter, not just the summary."""
    client = _FakeClient(
        json.dumps(
            {
                "summary": "A three\u2011day plan\u2014lighter lunches.",
                "days": [
                    {
                        "day": "Mon\u2011Tue",
                        "meals": [
                            {
                                "slot": "Lunch",
                                "suggestion": "Grilled boti\u2014no naan.",
                                "approx_calories": 600,
                            }
                        ],
                    }
                ],
                "nudges": ["Pizza twice\u2014try a veggie one."],
            }
        )
    )

    plan = await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    everything = " ".join(
        [plan.summary, *plan.nudges]
        + [d.day for d in plan.days]
        + [m.suggestion for d in plan.days for m in d.meals]
    )
    assert not [c for c in everything if ord(c) > 0x2000], everything
    assert "three-day" in plan.summary


async def test_the_calorie_reasoning_is_cleaned_too() -> None:
    client = _FakeClient(
        json.dumps({"calories": 700, "reasoning": "Cream\u2014heavy, so upper end."})
    )

    result = await GroqAIService(client, model=MODEL).adjust_calories(_calorie_request())

    assert result.reasoning == "Cream, heavy, so upper end."


# A Groq 400 for the empty generation case, close enough to the real message
# that _is_retryable is matching on what production actually sees.
_JSON_VALIDATE_FAILED = (
    "Error code: 400 - {'error': {'message': \"Failed to validate JSON. Please adjust "
    "your prompt. See 'failed_generation' for more details.\", 'type': "
    "'invalid_request_error', 'code': 'json_validate_failed', 'failed_generation': ''}}"
)

_PLAN_JSON = json.dumps(
    {
        "summary": "A steady week.",
        "days": [
            {
                "day": "Day 1",
                "meals": [{"slot": "breakfast", "suggestion": "Oats", "approx_calories": 300}],
            }
        ],
        "nudges": ["Drink water."],
    }
)


class _ScriptedCompletions:
    """Returns a scripted outcome per call: an Exception to raise, or content."""

    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.script.pop(0) if self.script else None
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=outcome))])


class _ScriptedClient:
    def __init__(self, script: list) -> None:
        self.completions = _ScriptedCompletions(script)
        self.chat = SimpleNamespace(completions=self.completions)


async def test_an_empty_generation_is_retried_rather_than_surfaced() -> None:
    """Measured live at 3 failures in 15 identical calls. One in five plan
    requests failing is not a rate the product can carry, and the failure is a
    coin toss rather than anything wrong with the request."""
    client = _ScriptedClient([RuntimeError(_JSON_VALIDATE_FAILED), _PLAN_JSON])

    plan = await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    assert plan.summary == "A steady week."
    assert len(client.completions.calls) == 2


async def test_a_completion_that_comes_back_blank_is_retried_too() -> None:
    """The same underlying fault, surfaced as a 200 with no content instead of
    as a 400."""
    client = _ScriptedClient([None, _PLAN_JSON])

    plan = await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    assert plan.summary == "A steady week."
    assert len(client.completions.calls) == 2


async def test_the_first_attempt_keeps_the_fixed_seed() -> None:
    """The calorie estimate gets stored against the meal, so the same dish
    producing a different number on a later log reads as a bug."""
    from app.services.ai.groq_service import BASE_SEED

    client = _ScriptedClient([json.dumps({"calories": 700, "reasoning": "rice"})])

    await GroqAIService(client, model=MODEL).adjust_calories(_calorie_request())

    assert client.completions.calls[0]["seed"] == BASE_SEED


async def test_each_retry_moves_off_the_seed_that_just_failed() -> None:
    """Asking again with the identical seed is asking for the generation that
    was just rejected."""
    client = _ScriptedClient(
        [RuntimeError(_JSON_VALIDATE_FAILED), RuntimeError(_JSON_VALIDATE_FAILED), _PLAN_JSON]
    )

    await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    seeds = [call["seed"] for call in client.completions.calls]
    assert len(seeds) == len(set(seeds)), f"a seed was reused across attempts: {seeds}"


async def test_it_gives_up_rather_than_retrying_forever() -> None:
    from app.services.ai.groq_service import MAX_ATTEMPTS

    client = _ScriptedClient([RuntimeError(_JSON_VALIDATE_FAILED)] * 10)

    with pytest.raises(GroqResponseError):
        await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    assert len(client.completions.calls) == MAX_ATTEMPTS


async def test_a_bad_key_is_not_retried() -> None:
    """It will fail identically every time, and retrying only makes the user
    wait three times as long to be told."""
    client = _ScriptedClient([RuntimeError("Error code: 401 - Invalid API Key")] * 5)

    with pytest.raises(GroqResponseError):
        await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    assert len(client.completions.calls) == 1


async def test_a_rate_limit_is_not_retried() -> None:
    """There is no backoff here, so an immediate second call is refused as well
    and spends the allowance doing it."""
    client = _ScriptedClient([RuntimeError("Error code: 429 - Rate limit reached")] * 5)

    with pytest.raises(GroqResponseError):
        await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    assert len(client.completions.calls) == 1


async def test_the_plan_budget_has_room_for_the_long_tail() -> None:
    """gpt-oss-20b is a reasoning model and spends this budget thinking. The
    same plan prompt was measured using between 759 and 5899 completion tokens,
    so the old 2048 ceiling truncated the slow runs into an empty reply."""
    client = _ScriptedClient([_PLAN_JSON])

    await GroqAIService(client, model=MODEL).generate_plan(_plan_request())

    assert client.completions.calls[0]["max_completion_tokens"] >= 6000
