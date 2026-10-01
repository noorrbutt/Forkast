"""SERVERLESS=true: nothing a request needs may be left for after the response.

On a serverless platform the process can be frozen the moment the response is
sent, so the jobs a request commits are awaited inline (bounded by a timeout)
instead of being scheduled behind it. Whatever goes wrong inline, the request
itself must still succeed and the job must stay queued for a worker.
"""

from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import NullPool

from app.config import Settings, _rewrite_database_url, get_settings
from app.db import engine_options
from app.main import app
from app.models import Job
from app.models.enums import JobStatus
from app.services import jobs
from app.services.ai.deps import get_ai_service

LOGS = "/api/v1/logs"

NEON_POOLER_URL = "postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require"


@pytest.fixture
def serverless(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "serverless", True)
    monkeypatch.setattr(settings, "serverless_job_timeout_seconds", 3.0)


def _never_behind_the_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """run_now is the behind-the-response path; serverless must not use it."""

    async def tripwire(*args, **kwargs):
        raise AssertionError("a job was scheduled behind the response on serverless")

    monkeypatch.setattr(jobs, "run_now", tripwire)


async def _a_category(client: AsyncClient, slug: str = "biryani") -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    return next(c for c in categories if c["slug"] == slug)


def _payload(category: dict, dish: str = "haleem") -> dict:
    return {
        "dish_name": dish,
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
    }


async def _jobs_of(session: AsyncSession, kind: str) -> list[Job]:
    session.expire_all()
    return list(await session.scalars(select(Job).where(Job.kind == kind)))


async def test_refinement_runs_inline_and_the_response_carries_it(
    serverless, monkeypatch: pytest.MonkeyPatch, auth_client: AsyncClient, session: AsyncSession
) -> None:
    _never_behind_the_response(monkeypatch)
    category = await _a_category(auth_client)

    response = await auth_client.post(LOGS, json=_payload(category))

    assert response.status_code == 201, response.text
    assert response.json()["refined"] is True
    [job] = await _jobs_of(session, jobs.REFINE_CALORIE_ESTIMATE)
    assert job.status is JobStatus.done


async def test_a_failed_inline_refinement_keeps_the_log_and_requeues_the_job(
    serverless, monkeypatch: pytest.MonkeyPatch, auth_client: AsyncClient, session: AsyncSession
) -> None:
    _never_behind_the_response(monkeypatch)
    category = await _a_category(auth_client)

    class Broken:
        async def adjust_calories(self, request):
            raise RuntimeError("the estimator is down")

    app.dependency_overrides[get_ai_service] = Broken

    response = await auth_client.post(LOGS, json=_payload(category))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["refined"] is False
    assert (
        category["base_calorie_min"] <= body["estimated_calories"] <= category["base_calorie_max"]
    )
    stored = (await auth_client.get(f"{LOGS}/{body['id']}")).json()
    assert stored["estimated_calories"] == body["estimated_calories"]

    [job] = await _jobs_of(session, jobs.REFINE_CALORIE_ESTIMATE)
    assert job.status is JobStatus.pending
    assert job.attempts == 1


async def test_a_hung_inline_refinement_times_out_and_requeues_the_job(
    serverless, monkeypatch: pytest.MonkeyPatch, auth_client: AsyncClient, session: AsyncSession
) -> None:
    _never_behind_the_response(monkeypatch)
    category = await _a_category(auth_client)

    class Hung:
        async def adjust_calories(self, request):
            await asyncio.sleep(30)

    app.dependency_overrides[get_ai_service] = Hung

    response = await asyncio.wait_for(auth_client.post(LOGS, json=_payload(category)), timeout=10)

    assert response.status_code == 201, response.text
    assert response.json()["refined"] is False
    [job] = await _jobs_of(session, jobs.REFINE_CALORIE_ESTIMATE)
    assert job.status is JobStatus.pending
    assert job.locked_at is None
    assert "timed out" in (job.last_error or "")


async def test_registration_succeeds_when_the_inline_email_fails(
    serverless, monkeypatch: pytest.MonkeyPatch, client: AsyncClient, session: AsyncSession
) -> None:
    _never_behind_the_response(monkeypatch)

    async def provider_down(payload, context):
        raise RuntimeError("the email provider is down")

    monkeypatch.setattr(jobs, "default_handlers", lambda: {jobs.SEND_EMAIL: provider_down})

    response = await client.post(
        "/api/v1/auth/register",
        json={
            "first_name": "Serverless",
            "last_name": "User",
            "email": "serverless-email-down@forkast.app",
            "password": "password123",
        },
    )

    assert response.status_code == 201, response.text
    [job] = await _jobs_of(session, jobs.SEND_EMAIL)
    assert job.status is JobStatus.pending
    assert job.attempts == 1


async def test_forgot_password_answers_202_when_the_inline_email_hangs(
    serverless, monkeypatch: pytest.MonkeyPatch, auth_client: AsyncClient, fixture_email: str
) -> None:
    _never_behind_the_response(monkeypatch)

    async def hung(payload, context):
        await asyncio.sleep(30)

    monkeypatch.setattr(jobs, "default_handlers", lambda: {jobs.SEND_EMAIL: hung})

    response = await asyncio.wait_for(
        auth_client.post("/api/v1/auth/forgot-password", json={"email": fixture_email}),
        timeout=10,
    )

    assert response.status_code == 202, response.text


def test_the_default_still_schedules_behind_the_response() -> None:
    assert get_settings().serverless is False

    class Recorder:
        def __init__(self) -> None:
            self.tasks: list = []

        def add_task(self, func, *args) -> None:
            self.tasks.append((func, args))

    background = Recorder()
    context = jobs.JobContext(factory=None)  # type: ignore[arg-type]
    job_id = jobs.new_uuid7()

    asyncio.run(jobs.run_for_request(background, job_id, context))

    assert background.tasks == [(jobs.run_now, (job_id, context))]


def test_engine_uses_nullpool_only_on_serverless() -> None:
    assert engine_options(serverless=True) == {"poolclass": NullPool}
    assert engine_options(serverless=False) == {"pool_pre_ping": True}


async def test_ready_reports_not_probed_on_serverless_groq(
    serverless, monkeypatch: pytest.MonkeyPatch, client: AsyncClient
) -> None:
    from app.config import AIProvider

    monkeypatch.setattr(get_settings(), "ai_provider", AIProvider.groq)

    response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json()["ai"] == "not_probed"


def test_neon_pooler_url_for_asyncpg() -> None:
    assert _rewrite_database_url(NEON_POOLER_URL, async_driver=True) == (
        "postgresql+asyncpg://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?ssl=require"
    )


def test_neon_pooler_url_for_psycopg_keeps_sslmode() -> None:
    assert _rewrite_database_url(NEON_POOLER_URL, async_driver=False) == (
        "postgresql+psycopg://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require"
    )


def test_channel_binding_is_stripped_only_for_asyncpg() -> None:
    url = NEON_POOLER_URL + "&channel_binding=require"

    assert _rewrite_database_url(url, async_driver=True) == (
        "postgresql+asyncpg://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?ssl=require"
    )
    assert _rewrite_database_url(url, async_driver=False) == (
        "postgresql+psycopg://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname"
        "?sslmode=require&channel_binding=require"
    )


def test_production_on_serverless_with_one_origin_boots() -> None:
    settings = Settings(
        _env_file=None,
        ENVIRONMENT="production",
        SERVERLESS="true",
        DATABASE_URL=NEON_POOLER_URL + "&channel_binding=require",
        TEST_DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/forkast_test",
        JWT_SECRET="a-very-long-secret-that-is-matching-the-required-minimum",
        CORS_ORIGINS="https://app.example.com",
        TRUST_PROXY_HEADERS="true",
        AI_PROVIDER="fake",
    )

    assert settings.serverless is True
    assert settings.cors_origin_list == ["https://app.example.com"]
    assert "channel_binding" not in settings.database_url
