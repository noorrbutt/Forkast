"""The real Groq implementation of the AI seam.

Both calls use strict structured output rather than asking for JSON in the
prompt and hoping. Groq validates the reply against the schema, so the failure
mode becomes a refusal we can catch instead of a plausible-looking string that
breaks json.loads in production.

Three details that are easy to get wrong and are not guessable from the SDK
signature:

* The parameter is ``max_completion_tokens``. ``max_tokens`` is still accepted
  as a legacy alias but should not be used in new code.
* Strict structured output is supported only on the gpt-oss models and
  qwen3.8-27b, and it is mutually exclusive with tool use. This seam needs
  structured output and no tools, so that trade costs nothing.
* The reply content is a JSON *string*. There is no ``.parse()`` helper, so it
  has to be json.loads'd and validated here.

Do not switch the model to ``llama-3.3-70b-versatile`` or
``llama-3.1-8b-instant``: both were shut down on 2026-08-16 even though they
lingered on the models page.

The model is never trusted to respect the calorie range. It is asked to stay
inside it, the schema constrains the shape of the reply, and then the caller
clamps the value anyway. A schema constrains structure, never the number inside.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.services.ai.prompts import CALORIE_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT
from app.services.ai.schemas import (
    CalorieAdjustRequest,
    CalorieAdjustResult,
    PlanRequest,
    PlanResult,
)

logger = logging.getLogger(__name__)

# How many recent logs to describe to the planner. The window is already capped
# upstream; this is a second bound so a future caller cannot accidentally send a
# year of history and blow up the prompt.
MAX_LOGS_IN_PROMPT = 40

# Attempts per request, including the first.
MAX_ATTEMPTS = 3

# The seed the first attempt always uses. Retries walk up from here.
BASE_SEED = 1337

# Token budgets. These are ceilings, not reservations: only what the model
# actually emits is billed.
#
# gpt-oss-20b is a reasoning model, so its chain of thought is spent out of this
# same budget and the visible JSON is a small fraction of it. A three day plan
# was measured using anywhere from 759 to 5899 completion tokens for identical
# input, so the old 2048 ceiling truncated the long tail into an empty reply.
# Calorie estimates were a steady 117, and 1024 is simply headroom for a dish
# name that makes the model think harder than usual.
PLAN_MAX_TOKENS = 8192
CALORIE_MAX_TOKENS = 1024

# Fragments that mark a failure as a coin toss rather than a standing problem.
# Groq reports the empty generation case as a 400, which is ordinarily a
# "do not try that again" status, so matching on the message is the only way to
# tell it apart from a genuinely malformed request.
_RETRYABLE_MARKERS = (
    "json_validate_failed",
    "Failed to validate JSON",
    "empty completion",
    "not JSON",
)


def _is_retryable(exc: Exception) -> bool:
    """Whether another attempt is likely to land differently.

    A bad key, a missing model or a malformed schema fail the same way every
    time, and retrying those only multiplies the wait before the user is told.
    A rate limit is excluded too: there is no backoff here, so an immediate
    second call would be refused as well and spend the allowance doing it.
    """
    text = str(exc)
    if "rate limit" in text.lower() or "429" in text:
        return False
    return any(marker in text for marker in _RETRYABLE_MARKERS)


CALORIE_SCHEMA: dict[str, Any] = {
    "name": "calorie_estimate",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "calories": {
                "type": "integer",
                "description": "Calories for one serving, inside the given range",
            },
            "reasoning": {
                "type": "string",
                "description": "One short sentence on what drove the number",
            },
        },
        "required": ["calories", "reasoning"],
        "additionalProperties": False,
    },
}

PLAN_SCHEMA: dict[str, Any] = {
    "name": "eating_plan",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "days": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "day": {"type": "string"},
                        "meals": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "slot": {"type": "string"},
                                    "suggestion": {"type": "string"},
                                    "approx_calories": {"type": "integer"},
                                },
                                "required": ["slot", "suggestion", "approx_calories"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["day", "meals"],
                    "additionalProperties": False,
                },
            },
            "nudges": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["summary", "days", "nudges"],
        "additionalProperties": False,
    },
}


# Typography the model reaches for and this product does not want. Left alone,
# these land in stored plan text and in the app's own copy. An em dash is the
# one that matters here; the rest come along for free because they break naive
# encodings on Windows and look inconsistent next to hand written strings.
_TYPOGRAPHY = {
    "\u2014": ", ",  # em dash, almost always joining two clauses
    "\u2013": ", ",  # en dash
    "\u2015": ", ",  # horizontal bar
    "\u2010": "-",  # hyphen
    "\u2011": "-",  # non-breaking hyphen, as in "three-day"
    "\u2012": "-",  # figure dash
    "\u2212": "-",  # minus sign
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2026": "...",
    "\u00a0": " ",  # non-breaking space
}


def normalise_text(value: str) -> str:
    """Rewrite the model's typography into plain ASCII punctuation.

    A prompt asking for this is a suggestion; a replacement table is a
    guarantee. The model produced em dashes in four of five nudges on the first
    live run, so asking nicely was never going to be enough.

    Spacing is tidied afterwards because an em dash is often written tight
    against both words, and a naive swap for ", " would otherwise leave
    "week ,maybe".
    """
    for bad, good in _TYPOGRAPHY.items():
        value = value.replace(bad, good)

    value = value.replace(" ,", ",")
    while ",  " in value:
        value = value.replace(",  ", ", ")
    return value.strip()


class GroqResponseError(RuntimeError):
    """Groq answered, but not with something usable."""


def _calorie_prompt(req: CalorieAdjustRequest) -> str:
    return (
        f"Dish: {req.dish_name}\n"
        f"Category: {req.category_name}\n"
        f"Range for this category: {req.base_calorie_min} to {req.base_calorie_max} kcal\n"
        "Place this dish inside that range. Ignore portion size, the caller "
        "applies it separately."
    )


def _plan_prompt(req: PlanRequest) -> str:
    if not req.recent_logs:
        history = "They have not logged anything yet."
    else:
        lines = [
            f"- {log.logged_at.date().isoformat()} {log.dish_name} "
            f"({log.category_name}, {log.cuisine_name}, "
            f"{'junk' if log.is_junk else 'regular'}, {log.estimated_calories} kcal)"
            for log in req.recent_logs[:MAX_LOGS_IN_PROMPT]
        ]
        history = "Recent meals, newest first:\n" + "\n".join(lines)

    if req.context is None:
        facts = ""
    else:
        c = req.context
        # Stated as settled facts, because they are. The app has already
        # counted. Handed only the raw list, the model counts for itself and
        # can tell someone they have eaten well this week while the dashboard
        # two taps away shows a junk ratio of sixty percent.
        facts = (
            "Figures the app has already calculated. Treat these as true and do "
            "not work them out again from the meals below:\n"
            f"- Window: the last {c.window_days} days\n"
            f"- Meals logged: {c.logs_count}\n"
            f"- Eaten {c.total_calories} kcal, burned {c.total_burned} kcal, "
            f"net {c.net_calories} kcal\n"
            f"- Average per day: {c.avg_calories_per_day} kcal\n"
            f"- Share of meals that were junk: {round(c.junk_ratio * 100)} percent\n"
            f"- Current junk free streak: {c.current_streak} days, "
            f"their best is {c.longest_streak}\n"
            + (f"- Most logged category: {c.top_category}\n" if c.top_category else "")
            + "\n"
        )

    return (
        f"Goal: {req.goal.value}\n"
        f"Their timezone: {req.timezone}\n\n"
        f"{facts}"
        f"{history}\n\n"
        "Write a three day plan that fits the way they already eat."
    )


class GroqAIService:
    """Implements AIService against the Groq API.

    The client is injected rather than constructed here, which keeps this class
    testable without a network call or an API key: a test passes a stand-in that
    returns a canned completion.
    """

    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def probe(self) -> None:
        """Fail fast if the configured Groq model is unavailable.

        Deliberately uses ``models.list()`` and not ``models.retrieve(id)``.
        ``retrieve`` puts the model id straight into the URL path
        (``GET /openai/v1/models/{id}``), and any model id containing a
        literal ``/`` (every ``openai/gpt-oss-*`` model does) gets percent
        encoded to ``%2F`` by the SDK before the request goes out. Groq's
        routing does not decode that back to a real slash, so it looks up
        the literal string ``openai%2Fgpt-oss-20b``, finds nothing, and
        returns a 404 model_not_found even though the model exists and
        works fine for chat completions. ``list()`` has no id-in-path
        problem, so membership-check against it instead.
        """
        try:
            listed = await self._client.models.list()
            names = {item.id for item in listed.data}
            if self._model not in names:
                raise GroqResponseError(f"Groq model {self._model} is not available")
        except Exception as exc:
            raise GroqResponseError(f"Groq model probe failed for {self._model}: {exc}") from exc

    async def _attempt(
        self, system: str, user: str, schema: dict[str, Any], max_tokens: int, seed: int
    ) -> Any:
        """One call. Raises GroqResponseError, transient or not, on any failure."""
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_schema", "json_schema": schema},
                temperature=0.2,
                max_completion_tokens=max_tokens,
                seed=seed,
            )
        except Exception as exc:
            # Everything the SDK can raise, from a timeout to a rate limit to a
            # bad key, becomes one exception type. The routes should not have to
            # know what Groq is in order to return a sensible status code, and
            # the seam exists precisely so a second provider would not change
            # their error handling.
            raise GroqResponseError(f"Groq request failed: {exc}") from exc

        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, KeyError) as exc:
            raise GroqResponseError("Groq returned no completion") from exc

        if not content:
            raise GroqResponseError("Groq returned an empty completion")

        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            # Strict schemas make this unlikely rather than impossible, and a
            # raw JSONDecodeError three frames down says nothing useful.
            logger.warning("Groq returned unparseable JSON: %r", content[:200])
            raise GroqResponseError("Groq returned content that was not JSON") from exc

    async def _complete(
        self, system: str, user: str, schema: dict[str, Any], max_tokens: int
    ) -> Any:
        """Call Groq, retrying the failures that are known to be a coin toss.

        Measured against the live API on 2026-09-16: the same plan prompt, same
        seed, same token budget, failed 3 times in 15 with
        ``json_validate_failed`` and an empty ``failed_generation``. Raising the
        budget did not move the rate, so this is not truncation. Under strict
        structured output the model occasionally emits nothing at all, Groq
        validates that against the schema, and the request 400s.

        A user cannot be shown a plan that failed for that reason, so one in
        five attempts arriving as "the plan generator is unavailable" is not a
        rate the product can carry. Three attempts takes it to roughly one in
        a hundred and twenty.
        """
        last: GroqResponseError | None = None

        for attempt in range(MAX_ATTEMPTS):
            # The first attempt keeps the fixed seed, which is what makes the
            # same dish tend to produce the same calorie figure: the estimate
            # gets stored, and a different number for the same meal reads as a
            # bug. Retries have to move off it, because asking again with the
            # identical seed is asking for the generation that just failed.
            try:
                return await self._attempt(system, user, schema, max_tokens, BASE_SEED + attempt)
            except GroqResponseError as exc:
                last = exc
                if attempt + 1 >= MAX_ATTEMPTS or not _is_retryable(exc):
                    break
                logger.info(
                    "Groq attempt %d of %d failed, retrying: %s",
                    attempt + 1,
                    MAX_ATTEMPTS,
                    exc,
                )

        if last is None:
            # The loop cannot exit without setting it, so this is unreachable.
            # It is a raise rather than an assert because `python -O` strips
            # asserts, and the next line would then raise None and surface as a
            # bare TypeError with none of the context above it.
            raise GroqResponseError("Groq made no attempt at all")
        logger.warning("Groq gave up after %d attempts: %s", MAX_ATTEMPTS, last)
        raise last

    async def adjust_calories(self, req: CalorieAdjustRequest) -> CalorieAdjustResult:
        payload = await self._complete(
            CALORIE_SYSTEM_PROMPT,
            _calorie_prompt(req),
            CALORIE_SCHEMA,
            max_tokens=CALORIE_MAX_TOKENS,
        )

        try:
            calories = float(payload["calories"])
        except (KeyError, TypeError, ValueError) as exc:
            raise GroqResponseError(f"Groq reply had no usable calories: {payload!r}") from exc

        # The caller clamps as well. Doing it here too means the reasoning text
        # matches the number actually returned, and keeps this class honest if
        # it is ever used outside that caller.
        clamped = max(float(req.base_calorie_min), min(float(req.base_calorie_max), calories))
        if clamped != calories:
            logger.info(
                "Groq returned %s for %r, outside %s-%s, clamped to %s",
                calories,
                req.dish_name,
                req.base_calorie_min,
                req.base_calorie_max,
                clamped,
            )

        reasoning = payload.get("reasoning")
        return CalorieAdjustResult(
            calories=clamped,
            reasoning=normalise_text(reasoning) if reasoning else None,
        )

    async def generate_plan(self, req: PlanRequest) -> PlanResult:
        payload = await self._complete(
            PLAN_SYSTEM_PROMPT, _plan_prompt(req), PLAN_SCHEMA, max_tokens=PLAN_MAX_TOKENS
        )

        try:
            plan = PlanResult.model_validate({**payload, "model": self._model})
        except Exception as exc:
            raise GroqResponseError(f"Groq plan did not match the expected shape: {exc}") from exc

        # Every string the user will read passes through the same filter.
        plan.summary = normalise_text(plan.summary)
        plan.nudges = [normalise_text(n) for n in plan.nudges]
        for day in plan.days:
            day.day = normalise_text(day.day)
            for meal in day.meals:
                meal.slot = normalise_text(meal.slot)
                meal.suggestion = normalise_text(meal.suggestion)
        return plan
