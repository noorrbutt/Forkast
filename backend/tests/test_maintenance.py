"""The refine-backfill maintenance task.

Nothing schedules this in-process; it exists because BackgroundTasks-based
refinement is lost on every restart, so a cron (or equivalent) is expected to
run `python -m app.maintenance refine-backfill` on a schedule -- see the
README's Deploy section. What is tested here is the task itself: that it
actually refines the stale rows it finds, bounded concurrency included.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import maintenance
from app.models import FoodCategory, FoodLog, User
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
