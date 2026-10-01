"""The refine-backfill maintenance task.

Refinement is a durable job now, so this is no longer what catches work a
restart lost; the worker is. It still catches what the queue gave up on or
never got: a dead-lettered refinement, a log saved while the Groq circuit
breaker was open, and logs older than the queue. It goes through the queue
itself, and leaves alone any log a job is already pending or running for.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import maintenance
from app.models import FoodCategory, FoodLog, Job, User
from app.models.enums import JobStatus
from app.services import jobs
from app.services.ai.fake import DeterministicAIService
from app.services.security import hash_password


async def _stale_log(session: AsyncSession, user: User, category: FoodCategory) -> FoodLog:
    log = FoodLog(
        user_id=user.id,
        dish_name="backfill me",
        category_id=category.id,
        serving_size="medium",
        rating=3,
        estimated_calories=500,
    )
    session.add(log)
    await session.flush()
    # Old enough to clear _refine_backfill's ten minute cutoff, and never
    # refined -- the exact shape a crashed BackgroundTasks refinement leaves
    # behind.
    log.created_at = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    log.estimate_refined_at = None
    return log


async def test_refine_backfill_refines_every_stale_row(
    session: AsyncSession, session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = User(
        email="backfill@forkast.app",
        password_hash=hash_password("password123"),
        email_verified=True,
        timezone="Asia/Karachi",
    )
    session.add(user)
    await session.flush()
    category = await session.scalar(select(FoodCategory).limit(1))
    assert category is not None

    logs = [await _stale_log(session, user, category) for _ in range(3)]
    log_ids = [log.id for log in logs]
    await session.commit()

    # _refine_backfill opens its own sessions through get_session_factory
    # rather than taking one as an argument, so it has to be pointed at the
    # test database's factory here -- app.db's own get_session_factory is
    # bound to DATABASE_URL, not TEST_DATABASE_URL, and using it would run
    # this test against whatever real database that happens to be.
    monkeypatch.setattr(maintenance, "get_session_factory", lambda: session_factory)
    monkeypatch.setattr(maintenance, "get_ai_service", lambda: DeterministicAIService())

    refined_count = await maintenance._refine_backfill(limit=10)
    assert refined_count >= len(log_ids)

    # Refinement committed through session_factory's own sessions, not this
    # one; with expire_on_commit=False this session's identity map would
    # otherwise hand back the pre-refinement rows it already cached above.
    session.expire_all()
    for log_id in log_ids:
        refreshed = await session.get(FoodLog, log_id)
        assert refreshed is not None
        assert refreshed.estimate_refined_at is not None


async def test_refine_backfill_requeues_dead_letters_but_leaves_live_jobs_alone(
    session: AsyncSession, session_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = User(email="backfill-jobs@forkast.app", password_hash="x", timezone="Asia/Karachi")
    session.add(user)
    await session.flush()
    category = await session.scalar(select(FoodCategory).limit(1))
    assert category is not None

    gave_up = await _stale_log(session, user, category)
    in_backoff = await _stale_log(session, user, category)
    for log, status in ((gave_up, JobStatus.dead_letter), (in_backoff, JobStatus.pending)):
        job = jobs.enqueue(
            session,
            jobs.REFINE_CALORIE_ESTIMATE,
            {"log_id": str(log.id), "category_id": category.id},
            run_at=dt.datetime.now(dt.UTC) + dt.timedelta(hours=1),
        )
        job.status = status
    gave_up_id, in_backoff_id = gave_up.id, in_backoff.id
    await session.commit()

    monkeypatch.setattr(maintenance, "get_session_factory", lambda: session_factory)
    monkeypatch.setattr(maintenance, "get_ai_service", lambda: DeterministicAIService())

    assert await maintenance._refine_backfill(limit=10) == 1

    session.expire_all()
    assert (await session.get(FoodLog, gave_up_id)).estimate_refined_at is not None
    # Its job is still waiting out a backoff; the worker owns that one.
    assert (await session.get(FoodLog, in_backoff_id)).estimate_refined_at is None
    statuses = sorted(s.value for s in await session.scalars(select(Job.status)))
    assert statuses == ["dead_letter", "done", "pending"]
