"""The circuit breaker around the calorie model.

The real GroqAIService is used throughout, with only its HTTP client replaced,
so what is counted is genuinely a Groq call going out or not. The interesting
cases: the breaker opens after N straight failures; while open nothing calls
Groq and new saves queue no refinement at all; after the cooldown exactly one
probe goes out, and its result decides whether the breaker closes or reopens.
"""

from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.main import app
from app.models import CircuitBreaker, FoodLog, Job
from app.services import circuit_breaker, jobs
from app.services.ai.deps import get_ai_service
from app.services.ai.groq_service import GroqAIService
from app.services.logs import refine_estimate

LOGS = "/api/v1/logs"


class _FakeGroqHTTP:
    """Stands in for AsyncGroq. Counts every chat completion that goes out."""

    def __init__(self) -> None:
        self.calls = 0
        self.failing = True
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls += 1
        if self.failing:
            # Not one of the transient markers, so GroqAIService makes exactly
            # one attempt per refinement and the counts below stay readable.
            raise RuntimeError("401 invalid api key")
        content = json.dumps({"calories": 700, "reasoning": "a big plate"})
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


@pytest.fixture
def groq() -> _FakeGroqHTTP:
    fake = _FakeGroqHTTP()
    service = GroqAIService(fake, model="test-model")
    app.dependency_overrides[get_ai_service] = lambda: service
    return fake


async def _save_meal(client: AsyncClient, dish: str) -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    category = next(c for c in categories if c["slug"] == "biryani")
    response = await client.post(
        LOGS,
        json={
            "dish_name": dish,
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _refine_job_count(session: AsyncSession) -> int:
    return await session.scalar(
        select(func.count()).select_from(Job).where(Job.kind == jobs.REFINE_CALORIE_ESTIMATE)
    )


async def _breaker(session: AsyncSession) -> CircuitBreaker:
    session.expire_all()
    row = await session.get(CircuitBreaker, circuit_breaker.GROQ)
    assert row is not None
    return row


async def _elapse_cooldown(session: AsyncSession) -> None:
    past = dt.datetime.now(dt.UTC) - dt.timedelta(
        seconds=get_settings().ai_breaker_cooldown_seconds + 1
    )
    await session.execute(
        update(CircuitBreaker)
        .where(CircuitBreaker.name == circuit_breaker.GROQ)
        .values(opened_at=past)
    )
    await session.commit()


async def _open_the_breaker(
    client: AsyncClient, groq: _FakeGroqHTTP, session: AsyncSession
) -> None:
    threshold = get_settings().ai_breaker_threshold
    for n in range(threshold):
        await _save_meal(client, f"dish {n}")
    assert groq.calls == threshold
    breaker = await _breaker(session)
    assert breaker.failures == threshold
    assert breaker.opened_at is not None
    assert await circuit_breaker.is_open(session)


async def test_the_breaker_opens_short_circuits_and_closes_after_a_good_probe(
    auth_client: AsyncClient, groq: _FakeGroqHTTP, session: AsyncSession, session_factory
) -> None:
    threshold = get_settings().ai_breaker_threshold
    # One short of the threshold leaves it closed.
    for n in range(threshold - 1):
        await _save_meal(auth_client, f"dish {n}")
    assert not await circuit_breaker.is_open(session)
    await _save_meal(auth_client, "the last straw")
    assert groq.calls == threshold
    assert await circuit_breaker.is_open(session)

    # Open: a save still works and still gets its provisional figure, but no
    # refinement is queued for it and Groq is not called.
    jobs_before = await _refine_job_count(session)
    saved = await _save_meal(auth_client, "while open")
    assert saved["refined"] is False
    assert await _refine_job_count(session) == jobs_before
    assert groq.calls == threshold

    # A refinement that was already queued short-circuits too, and keeps the
    # provisional figure rather than failing.
    log_id = await session.scalar(select(FoodLog.id).where(FoodLog.dish_name == "dish 0"))
    category_id = await session.scalar(select(FoodLog.category_id).where(FoodLog.id == log_id))
    service = app.dependency_overrides[get_ai_service]()
    assert await refine_estimate(log_id, category_id, service, session_factory) is False
    assert groq.calls == threshold

    # Cooldown over: half-open, so saves queue again, and the first refinement
    # is the probe. Groq is back, so the probe succeeds and closes it.
    await _elapse_cooldown(session)
    assert not await circuit_breaker.is_open(session)
    groq.failing = False
    probed = await _save_meal(auth_client, "the probe")
    assert groq.calls == threshold + 1
    assert (await auth_client.get(f"{LOGS}/{probed['id']}")).json()["refined"] is True

    breaker = await _breaker(session)
    assert breaker.failures == 0
    assert breaker.opened_at is None
    # Closed again: calls flow normally.
    await _save_meal(auth_client, "back to normal")
    assert groq.calls == threshold + 2


async def test_a_failed_probe_reopens_the_breaker_and_restarts_the_cooldown(
    auth_client: AsyncClient, groq: _FakeGroqHTTP, session: AsyncSession
) -> None:
    await _open_the_breaker(auth_client, groq, session)
    first_opened = (await _breaker(session)).opened_at

    await _elapse_cooldown(session)
    await _save_meal(auth_client, "failed probe")
    threshold = get_settings().ai_breaker_threshold
    assert groq.calls == threshold + 1

    breaker = await _breaker(session)
    assert breaker.opened_at is not None and breaker.opened_at > first_opened
    assert await circuit_breaker.is_open(session)
    await _save_meal(auth_client, "still open")
    assert groq.calls == threshold + 1


async def test_only_one_half_open_probe_goes_out(
    auth_client: AsyncClient, groq: _FakeGroqHTTP, session: AsyncSession, session_factory
) -> None:
    await _open_the_breaker(auth_client, groq, session)
    await _elapse_cooldown(session)

    allowed = [await circuit_breaker.allow(session_factory) for _ in range(3)]
    assert allowed == [True, False, False]
