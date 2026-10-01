"""GET /queue: how deep the jobs queue is, and how much has dead-lettered."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
