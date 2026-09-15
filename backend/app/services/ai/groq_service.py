"""Real Groq implementation.

TODO: NOT IMPLEMENTED YET. Every method below raises NotImplementedError.

The call shape sketched here is correct and current as of 2026-09-16, so
finishing this is a matter of replacing the raise with the commented body:

    resp = await self._client.chat.completions.create(
        model=self._model,
        messages=[
            {"role": "system", "content": CALORIE_SYSTEM_PROMPT},
            {"role": "user", "content": user_payload},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "calorie_estimate",
                "strict": True,
                "schema": {...},
            },
        },
        temperature=0.2,
        max_completion_tokens=512,
        seed=1337,
    )
    raw = resp.choices[0].message.content

Four things that are easy to get wrong:

1. Model id. Use openai/gpt-oss-20b, or openai/gpt-oss-120b for the plan seam
   if 20b underperforms. Do NOT use llama-3.3-70b-versatile or
   llama-3.1-8b-instant: Groq's deprecation table gives them a shutdown date of
   2026-08-16, even though the models page still lists them as production.
2. The parameter is max_completion_tokens, not max_tokens. The old name is
   still accepted as a legacy alias but should not be used in new code.
3. Strict structured output is supported only on the gpt-oss pair and
   qwen/qwen3.8-27b, and it is mutually exclusive with tool use. This seam
   needs structured output and no tools, so that trade costs nothing.
4. The response content is a JSON string. There is no .parse() helper, so
   json.loads it and validate with the pydantic models in schemas.py.

The result must still be clamped into the category range on our side. A strict
schema constrains the shape of the reply, never the value inside it.
"""

from __future__ import annotations

from typing import Any

from app.services.ai.schemas import (
    CalorieAdjustRequest,
    CalorieAdjustResult,
    PlanRequest,
    PlanResult,
)


class GroqAIService:
    """Implements AIService against the Groq API. Not yet implemented."""

    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def adjust_calories(self, req: CalorieAdjustRequest) -> CalorieAdjustResult:
        raise NotImplementedError(
            "GroqAIService.adjust_calories is a TODO stub. "
            "Set AI_PROVIDER=fake to use the deterministic estimator."
        )

    async def generate_plan(self, req: PlanRequest) -> PlanResult:
        raise NotImplementedError(
            "GroqAIService.generate_plan is a TODO stub. "
            "Set AI_PROVIDER=fake to use the deterministic planner."
        )
