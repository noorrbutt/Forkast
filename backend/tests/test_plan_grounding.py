"""The plan has to agree with the dashboard.

The planner used to be handed a bare list of meals and left to work out the
pattern for itself. Nothing tied its arithmetic to the app's, so it could open
with "you have kept things light this week" while the dashboard two taps away
showed a junk ratio of sixty percent. Same user, same second, two different
stories, and the user has no way to tell which one to believe.

So the route now sends the figures it has already computed, and these tests
pin them to the ones the dashboard and streaks endpoints return.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.main import app
from app.services.ai.deps import get_ai_service
from app.services.ai.fake import DeterministicAIService
from app.services.ai.groq_service import _plan_prompt
from app.services.ai.schemas import PlanContext, PlanRequest, PlanResult
from app.models.enums import Goal

LOGS = "/api/v1/logs"


class _CapturingAI:
    """Records the plan request, and otherwise behaves like the normal stub.

    Calorie estimation has to keep working, because these tests log meals in
    order to have figures worth comparing in the first place.
    """

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


async def _eat(client: AsyncClient, slug: str, dish: str = "test meal") -> None:
    categories = {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}
    response = await client.post(
        LOGS,
        json={
            "dish_name": dish,
            "category_id": categories[slug]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 201, response.text


async def test_the_planner_is_told_the_dashboard_figures(
    auth_client: AsyncClient, capture: _CapturingAI
) -> None:
    await _eat(auth_client, "biryani")
    await _eat(auth_client, "salad")
    await auth_client.put("/api/v1/burn", json={"calories": 250})

    assert (await auth_client.post("/api/v1/plans", json={"goal": "cut"})).status_code == 201

    dash = (await auth_client.get("/api/v1/dashboard")).json()
    streak = (await auth_client.get("/api/v1/streaks")).json()
    context = capture.seen.context

    assert context is not None, "the planner was handed no computed figures at all"
    assert context.logs_count == dash["logs_count"]
    assert context.total_calories == dash["total_calories"]
    assert context.total_burned == dash["total_burned"]
    assert context.net_calories == dash["net_calories"]
    assert context.junk_ratio == dash["junk_ratio"]
    assert context.current_streak == streak["current_streak"]
    assert context.longest_streak == streak["longest_streak"]


async def test_the_junk_ratio_the_plan_sees_is_the_one_on_screen(
    auth_client: AsyncClient, capture: _CapturingAI
) -> None:
    """The figure most likely to be contradicted in a written summary."""
    await _eat(auth_client, "burger")
    await _eat(auth_client, "burger", dish="another")
    await _eat(auth_client, "salad")

    await auth_client.post("/api/v1/plans", json={})

    on_screen = (await auth_client.get("/api/v1/dashboard")).json()["junk_ratio"]
    assert capture.seen.context.junk_ratio == on_screen
    assert on_screen > 0, "this test is worthless if nothing counted as junk"


async def test_a_brand_new_account_still_gets_a_context(
    auth_client: AsyncClient, capture: _CapturingAI
) -> None:
    """Zero is a figure. Sending nothing would put the model back to guessing."""
    await auth_client.post("/api/v1/plans", json={})

    context = capture.seen.context
    assert context is not None
    assert context.logs_count == 0
    assert context.total_calories == 0
    assert context.avg_calories_per_day == 0
    assert context.window_days > 0, "a zero window would divide by zero"


def test_the_prompt_states_the_figures_and_forbids_recounting() -> None:
    """Carrying the numbers in the request is only half of it. They have to
    reach the model, and the model has to be told they are settled."""
    context = PlanContext(
        window_days=14,
        logs_count=9,
        total_calories=7200,
        total_burned=400,
        net_calories=6800,
        junk_ratio=0.33,
        avg_calories_per_day=514,
        current_streak=3,
        longest_streak=11,
        top_category="Biryani",
    )
    prompt = _plan_prompt(
        PlanRequest(goal=Goal.cut, timezone="Asia/Karachi", recent_logs=[], context=context)
    )

    assert "do not work them out again" in prompt
    for figure in ("14", "9", "7200", "400", "6800", "33 percent", "514", "3", "11", "Biryani"):
        assert figure in prompt, f"the planner never sees {figure}"


def test_the_prompt_survives_having_no_context() -> None:
    """The seam allows it, so it must not crash, and it must not invent a zero
    it was never given."""
    prompt = _plan_prompt(
        PlanRequest(goal=Goal.maintain, timezone="Asia/Karachi", recent_logs=[], context=None)
    )

    assert "Goal: maintain" in prompt
    assert "Figures the app has already calculated" not in prompt
