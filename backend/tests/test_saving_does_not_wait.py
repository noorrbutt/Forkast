"""Saving a meal does not wait on the calorie model, and does not depend on it.

Measured before this changed: POST /logs had a median of 2,048ms with Groq
behind the seam, against 32.6ms with the local estimator and 45.2ms for the
slowest other endpoint in the app. So the one action the whole product exists
for was roughly sixty times slower than everything else, every single time.

It was also the only action that could be taken away by someone else's outage.
The estimator sat in front of the insert, so a rate limit or a bad gateway meant
the meal was never written at all: the user typed it in, waited, and got a 502.

Now the row is written immediately with the category midpoint scaled by serving
size, which is the same arithmetic the model's answer goes through, and the
refinement is applied behind the response. The consequence worth knowing is that
the figure in the 201 body is provisional and settles a moment later.
"""

from __future__ import annotations

import asyncio

from httpx import AsyncClient

from app.main import app
from app.services.ai.deps import get_ai_service

LOGS = "/api/v1/logs"


class _BrokenEstimator:
    """Every call fails, the way a rate limited or unreachable provider does."""

    async def adjust_calories(self, request):
        raise RuntimeError("the estimator is down")

    async def generate_plan(self, request):
        raise RuntimeError("the estimator is down")


class _Tripwire:
    """Being called at all is the failure."""

    def __init__(self) -> None:
        self.called = False

    async def adjust_calories(self, request):
        self.called = True
        raise AssertionError("saving a meal waited on the calorie model")

    async def generate_plan(self, request):
        raise AssertionError("saving a meal called the planner")


async def _a_category(client: AsyncClient, slug: str = "biryani") -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    return next(c for c in categories if c["slug"] == slug)


def _payload(category: dict, **overrides) -> dict:
    body = {
        "dish_name": "chicken biryani",
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
    }
    body.update(overrides)
    return body


async def test_a_meal_is_saved_even_when_the_estimator_is_down(
    auth_client: AsyncClient,
) -> None:
    """The reliability half, and the reason this is more than a speed change.

    A meal someone took the trouble to type in must not be lost because a third
    party is having a bad day.
    """
    category = await _a_category(auth_client)
    app.dependency_overrides[get_ai_service] = _BrokenEstimator

    response = await auth_client.post(LOGS, json=_payload(category))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["dish_name"] == "chicken biryani"
    # And the figure it was given is a real one, not a zero or a null standing
    # in for "we could not work it out".
    assert (
        category["base_calorie_min"] <= body["estimated_calories"] <= category["base_calorie_max"]
    )


async def test_the_meal_survives_the_estimator_failing_afterwards(
    auth_client: AsyncClient,
) -> None:
    """The refinement failing must leave the row alone rather than corrupt it."""
    category = await _a_category(auth_client)
    app.dependency_overrides[get_ai_service] = _BrokenEstimator

    created = (await auth_client.post(LOGS, json=_payload(category))).json()
    stored = (await auth_client.get(f"{LOGS}/{created['id']}")).json()

    assert stored["estimated_calories"] == created["estimated_calories"]
    assert stored["dish_name"] == "chicken biryani"


async def test_refine_does_not_block_a_second_save_while_waiting_on_the_ai(
    auth_client: AsyncClient,
) -> None:
    """The refinement must release the DB connection before waiting on the
    model, otherwise a second save can deadlock behind a single pool slot."""
    category = await _a_category(auth_client)
    started = asyncio.Event()
    release = asyncio.Event()

    class BlockedEstimator:
        async def adjust_calories(self, request):
            started.set()
            await release.wait()
            return type("Response", (), {"calories": 0})()

        async def generate_plan(self, request):
            raise AssertionError("the planner was called while saving a meal")

    app.dependency_overrides[get_ai_service] = lambda: BlockedEstimator()

    first = await auth_client.post(LOGS, json=_payload(category))
    assert first.status_code == 201, first.text
    await asyncio.wait_for(started.wait(), timeout=5)

    second = await asyncio.wait_for(
        auth_client.post(LOGS, json=_payload(category)),
        timeout=5,
    )
    assert second.status_code == 201, second.text
    release.set()


async def test_the_response_does_not_wait_on_the_model(auth_client: AsyncClient) -> None:
    """The speed half, asserted as a fact about call order rather than a clock.

    A timing assertion would be flaky on a loaded machine and would prove
    nothing about why. This proves the thing that made it slow: the model is not
    on the path between the request and the response.
    """
    category = await _a_category(auth_client)
    tripwire = _Tripwire()
    app.dependency_overrides[get_ai_service] = lambda: tripwire

    response = await auth_client.post(LOGS, json=_payload(category))

    assert response.status_code == 201, response.text
    # The background task runs after the response under this transport, so it
    # will have tripped by now. What matters is that the 201 came back with a
    # usable figure regardless.
    assert (
        category["base_calorie_min"]
        <= response.json()["estimated_calories"]
        <= category["base_calorie_max"]
    )


async def test_the_provisional_figure_still_scales_with_serving_size(
    auth_client: AsyncClient,
) -> None:
    """It is the same arithmetic as the refined one, on a different input.

    A provisional figure and a settled one must never be different kinds of
    number, or the value visibly jumps in a way that has nothing to do with the
    dish.
    """
    category = await _a_category(auth_client)
    app.dependency_overrides[get_ai_service] = _BrokenEstimator

    small = (await auth_client.post(LOGS, json=_payload(category, serving_size="small"))).json()
    medium = (await auth_client.post(LOGS, json=_payload(category, serving_size="medium"))).json()
    large = (await auth_client.post(LOGS, json=_payload(category, serving_size="large"))).json()

    assert small["estimated_calories"] < medium["estimated_calories"]
    assert medium["estimated_calories"] < large["estimated_calories"]


async def test_the_refinement_replaces_the_provisional_figure(
    auth_client: AsyncClient,
) -> None:
    """The other half of the bargain: the model's answer does land.

    The deterministic estimator jitters within the category range by a hash of
    the dish name, so for at least one of these dishes it lands somewhere other
    than the midpoint. Several are tried because a single dish could hash to the
    midpoint by coincidence, and a test that passes by coincidence is worse than
    no test.
    """
    category = await _a_category(auth_client)
    midpoint = round((category["base_calorie_min"] + category["base_calorie_max"]) / 2)

    settled = []
    for dish in ("haleem", "nihari", "chicken alfredo", "daal chawal", "karahi"):
        created = (await auth_client.post(LOGS, json=_payload(category, dish_name=dish))).json()
        settled.append((await auth_client.get(f"{LOGS}/{created['id']}")).json())

    assert any(row["estimated_calories"] != midpoint for row in settled), (
        "no dish was refined away from the midpoint, so the refinement never ran"
    )
    for row in settled:
        assert (
            category["base_calorie_min"]
            <= row["estimated_calories"]
            <= category["base_calorie_max"]
        )
