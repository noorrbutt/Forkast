"""GET /queue: how deep the jobs queue is, and how much has dead-lettered."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Environment
from app.models.enums import JobStatus
from app.services import jobs


async def test_queue_reports_pending_by_kind_and_dead_letters(
    client: AsyncClient, session: AsyncSession
) -> None:
    for kind in ("send_email", "send_email", "refine_calorie_estimate"):
        jobs.enqueue(session, kind, {})
    jobs.enqueue(session, "send_email", {}).status = JobStatus.dead_letter
    jobs.enqueue(session, "send_email", {}).status = JobStatus.done
    await session.commit()

    response = await client.get("/queue")

    assert response.status_code == 200
    assert response.json() == {
        "pending": 3,
        "pending_by_kind": {"send_email": 2, "refine_calorie_estimate": 1},
        "running": 0,
        "dead_letter": 1,
        "dead_letter_by_kind": {"send_email": 1},
        "ai_breaker_open": False,
    }


async def test_queue_stays_open_in_dev_with_no_token_configured(client: AsyncClient) -> None:
    """The suite's own settings have no METRICS_TOKEN and run with
    ENVIRONMENT=dev, same as a laptop -- this has to stay frictionless
    there, which is exactly why the fail-closed default above is scoped to
    production rather than applying everywhere unset is true."""
    response = await client.get("/queue")
    assert response.status_code == 200


async def test_queue_is_404_in_production_with_no_token_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.main as main_module

    monkeypatch.setattr(main_module.settings, "environment", Environment.production)

    response = await client.get("/queue")

    assert response.status_code == 404


async def test_queue_needs_the_right_token_once_one_is_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pydantic import SecretStr

    import app.main as main_module

    monkeypatch.setattr(main_module.settings, "metrics_token", SecretStr("correct-horse"))

    no_header = await client.get("/queue")
    assert no_header.status_code == 404

    wrong_token = await client.get("/queue", headers={"X-Metrics-Token": "wrong"})
    assert wrong_token.status_code == 404

    right_token = await client.get("/queue", headers={"X-Metrics-Token": "correct-horse"})
    assert right_token.status_code == 200
