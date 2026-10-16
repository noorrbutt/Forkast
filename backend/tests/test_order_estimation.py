"""POST /logs/estimate-order: reading a delivery-order screenshot into
editable line items.

Mirrors test_photo_estimation_endpoint.py and test_photo_estimation_limits.py
in shape: the fake provider exercises upload validation, grounding/clamping
and privacy; the "live" cases (rate limit, kill switch, breaker) are driven
the same way those files drive them, by overriding get_estimate_source to
"ai" while keeping the actual estimator the safe deterministic stub.
"""

from __future__ import annotations

import base64
import datetime as dt

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.main import app
from app.models import CircuitBreaker
from app.services import circuit_breaker
from app.services.ai.deps import get_ai_service, get_estimate_source
from app.services.ai.schemas import OrderEstimate, OrderLineItem

ESTIMATE = "/api/v1/logs/estimate-order"

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _upload(data: bytes, name: str = "order.png", content_type: str = "image/png") -> dict:
    return {"file": (name, data, content_type)}


@pytest.fixture
def live_estimate_source():
    app.dependency_overrides[get_estimate_source] = lambda: "ai"
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_estimate_source, None)


class _StubAI:
    """A minimal AIService whose only interesting method is estimate_order."""

    def __init__(self, result: OrderEstimate | None = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls = 0

    async def adjust_calories(self, req):
        raise NotImplementedError

    async def generate_plan(self, req):
        raise NotImplementedError

    async def estimate_from_photo(self, image, content_type):
        raise NotImplementedError

    async def estimate_order(self, image, content_type):
        self.calls += 1
        if self.error is not None:
            raise self.error
        assert self.result is not None
        return self.result


# --- the happy path, on the fake provider ---


async def test_an_order_returns_grounded_items_without_creating_a_log(
    auth_client: AsyncClient,
) -> None:
    before = (await auth_client.get("/api/v1/logs")).json()["total"]
    categories = (await auth_client.get("/api/v1/categories")).json()
    biryani = next(c for c in categories if c["slug"] == "biryani")

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["restaurant_name"] == "Student Biryani"
    assert len(body["items"]) == 2
    biryani_item = next(i for i in body["items"] if i["name"] == "chicken biryani")
    # Grounded against the real biryani category range (600-950), not
    # whatever raw figure the fake happened to return.
    assert biryani_item["category_id"] == biryani["id"]
    assert biryani["base_calorie_min"] <= biryani_item["kcal_min"] <= biryani_item["kcal_max"]
    assert biryani_item["kcal_max"] <= biryani["base_calorie_max"]
    # "coke" is not in the desi table, so it is still offered, just unmatched.
    coke_item = next(i for i in body["items"] if i["name"] == "coke")
    assert coke_item["category_id"] is None
    assert coke_item["qty"] == 2
    # Nothing was written: this is a preview, same as estimate-photo.
    assert (await auth_client.get("/api/v1/logs")).json()["total"] == before


async def test_the_estimate_names_which_source_actually_answered(
    auth_client: AsyncClient,
) -> None:
    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text
    assert response.json()["estimate_source"] == "local"


async def test_a_screenshot_that_is_not_an_order_returns_empty_items(
    auth_client: AsyncClient,
) -> None:
    app.dependency_overrides[get_ai_service] = lambda: _StubAI(
        OrderEstimate(restaurant_name=None, items=[])
    )
    try:
        response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "restaurant_name": None,
        "items": [],
        "estimate_source": "local",
    }


# --- items cap and clamping ---


async def test_items_beyond_twelve_are_not_returned(auth_client: AsyncClient) -> None:
    many = OrderEstimate(
        restaurant_name=None,
        items=[
            OrderLineItem(name=f"item {i}", qty=1, kcal_min=100, kcal_max=200, confidence="low")
            for i in range(20)
        ],
    )
    app.dependency_overrides[get_ai_service] = lambda: _StubAI(many)
    try:
        response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) <= 12


async def test_an_item_matching_a_tight_category_is_clamped_into_it(
    auth_client: AsyncClient,
) -> None:
    """tea_coffee's real range is 90-160; a wildly high raw guess has to land
    inside that, not the model's own unclamped figure."""
    categories = (await auth_client.get("/api/v1/categories")).json()
    tea = next(c for c in categories if c["slug"] == "tea_coffee")

    wild = OrderEstimate(
        restaurant_name=None,
        items=[OrderLineItem(name="chai", qty=1, kcal_min=900, kcal_max=1200, confidence="high")],
    )
    app.dependency_overrides[get_ai_service] = lambda: _StubAI(wild)
    try:
        response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    item = response.json()["items"][0]
    assert item["category_id"] == tea["id"]
    assert (
        tea["base_calorie_min"] <= item["kcal_min"] <= item["kcal_max"] <= tea["base_calorie_max"]
    )


# --- upload validation ---


async def test_an_oversized_screenshot_is_refused_with_413(auth_client: AsyncClient) -> None:
    from app.models import MAX_PHOTO_BYTES

    too_big = PNG + b"\x00" * (MAX_PHOTO_BYTES + 1 - len(PNG))

    response = await auth_client.post(ESTIMATE, files=_upload(too_big))

    assert response.status_code == 413
    assert "KB" in response.json()["detail"], response.text


async def test_an_empty_file_is_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.post(ESTIMATE, files=_upload(b""))

    assert response.status_code == 422


async def test_the_route_needs_a_token(client: AsyncClient) -> None:
    assert (await client.post(ESTIMATE, files=_upload(PNG))).status_code == 401


# --- privacy: nothing from the image is ever stored ---


async def test_nothing_is_persisted_by_an_order_estimate(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    from app.models import FoodLog, FoodLogPhoto

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    assert response.status_code == 200, response.text

    assert (await session.scalar(select(FoodLog))) is None
    assert (await session.scalar(select(FoodLogPhoto))) is None


async def test_the_dead_provider_message_does_not_leak_upstream_text(
    auth_client: AsyncClient,
) -> None:
    from app.services.ai.groq_service import GroqResponseError

    app.dependency_overrides[get_ai_service] = lambda: _StubAI(
        error=GroqResponseError("marker: upstream response text must not leak")
    )
    try:
        response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 502, response.text
    assert response.json()["detail"] == "The order scanner is unavailable."
    assert "marker: upstream response text must not leak" not in response.text


# --- live-only behaviour: rate limits, kill switch, breaker ---


async def test_the_fake_provider_is_never_rate_limited(auth_client: AsyncClient) -> None:
    limit = get_settings().order_estimate_rate_limit

    statuses = [
        (await auth_client.post(ESTIMATE, files=_upload(PNG))).status_code for _ in range(limit + 2)
    ]

    assert 429 not in statuses, f"the fake provider was throttled: {statuses}"


async def test_too_many_orders_in_the_short_window_are_refused(
    auth_client: AsyncClient, live_estimate_source
) -> None:
    limit = get_settings().order_estimate_rate_limit

    statuses = [
        (await auth_client.post(ESTIMATE, files=_upload(PNG))).status_code for _ in range(limit + 2)
    ]

    assert 429 in statuses, f"order estimation was never throttled: {statuses}"


async def test_the_daily_cap_catches_what_the_short_window_would_allow(
    auth_client: AsyncClient, live_estimate_source, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "order_estimate_rate_limit", 1000)
    monkeypatch.setattr(settings, "order_estimate_daily_limit", 3)

    statuses = [
        (await auth_client.post(ESTIMATE, files=_upload(PNG))).status_code for _ in range(5)
    ]

    assert 429 in statuses, f"the daily cap was never enforced: {statuses}"


async def test_the_kill_switch_has_no_effect_on_the_fake_provider(
    auth_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "photo_estimate_enabled", False)

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text


async def test_the_kill_switch_takes_the_route_out_of_service_when_live(
    auth_client: AsyncClient, live_estimate_source, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Shares photo_estimate_enabled with the plain photo route on purpose:
    see guard_order_estimate's own docstring."""
    monkeypatch.setattr(get_settings(), "photo_estimate_enabled", False)

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 503, response.text
    assert "temporarily unavailable" in response.json()["detail"].lower()


async def test_an_open_breaker_refuses_the_call_before_touching_the_network(
    auth_client: AsyncClient, live_estimate_source, session: AsyncSession
) -> None:
    session.add(
        CircuitBreaker(name=circuit_breaker.GROQ, failures=99, opened_at=dt.datetime.now(dt.UTC))
    )
    await session.commit()

    stub = _StubAI(OrderEstimate(restaurant_name=None, items=[]))
    app.dependency_overrides[get_ai_service] = lambda: stub
    try:
        response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 503, response.text
    assert stub.calls == 0, "the breaker should have refused before any call went out"


async def test_the_breaker_is_not_consulted_on_the_fake_provider(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    """guard/estimate_order both skip the breaker check entirely when the
    estimate is not live, the same way they skip rate limiting -- the fake
    stub never fails, so there is nothing for the breaker to protect."""
    session.add(
        CircuitBreaker(name=circuit_breaker.GROQ, failures=99, opened_at=dt.datetime.now(dt.UTC))
    )
    await session.commit()

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text
