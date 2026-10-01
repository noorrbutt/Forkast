"""AI meal plans: grounding them in the user's real history, and storing them.

Only the text generation comes from the AI seam. The facts the planner is
handed are the same figures the dashboard and streak screens show, so its
narrative cannot contradict the numbers the user is looking at.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import AIPlan, FoodCategory, FoodLog, User
from app.services.ai.base import AIService
from app.services.ai.deps import EstimateSource
from app.services.ai.groq_service import GroqResponseError
from app.services.ai.schemas import PlanContext, PlanLogSummary, PlanRequest
from app.services.insights import build_dashboard, compute_streaks

logger = logging.getLogger(__name__)

# How many recent logs to hand the planner. Enough to spot a pattern, small
# enough to keep the prompt cheap once a real model is behind it.
PLAN_LOG_WINDOW = 30


async def _recent_log_summaries(session: AsyncSession, user: User) -> list[PlanLogSummary]:
    recent = await session.scalars(
        select(FoodLog)
        .where(FoodLog.user_id == user.id)
        .order_by(FoodLog.created_at.desc())
        .limit(PLAN_LOG_WINDOW)
        .options(selectinload(FoodLog.category).selectinload(FoodCategory.cuisine))
    )
    return [
        PlanLogSummary(
            dish_name=log.dish_name,
            category_name=log.category.name,
            cuisine_name=log.category.cuisine.name,
            is_junk=log.category.is_junk,
            estimated_calories=log.estimated_calories,
            logged_at=log.created_at,
        )
        for log in recent
    ]


async def _plan_context(session: AsyncSession, user: User) -> PlanContext:
    dashboard = await build_dashboard(session, user)
    streak = await compute_streaks(session, user)
    days = len(dashboard.calories_by_day) or 1

    # Averaged over the chart window, from the chart's own per-day figures.
    #
    # It used to be total_calories / days, and those two are not the same span:
    # total_calories sums the account's entire history with no date filter,
    # while days is the length of the fourteen day chart window. An account with
    # a year behind it was handed its whole year divided by a fortnight and told
    # that was a daily average, so a real 1,800 arrived at the planner as 28,000
    # -- presented as a figure the model is explicitly forbidden to re-derive.
    windowed_calories = sum(day.calories for day in dashboard.calories_by_day)

    return PlanContext(
        window_days=days,
        logs_count=dashboard.logs_count,
        total_calories=dashboard.total_calories,
        total_burned=dashboard.total_burned,
        net_calories=dashboard.net_calories,
        junk_ratio=dashboard.junk_ratio,
        avg_calories_per_day=round(windowed_calories / days),
        current_streak=streak.current_streak,
        longest_streak=streak.longest_streak,
        top_category=dashboard.top_category.name if dashboard.top_category else None,
        eating_out_frequency=user.eating_out_frequency,
        biggest_struggle=user.biggest_struggle,
    )


async def create_plan(
    session: AsyncSession,
    ai: AIService,
    user: User,
    goal: str | None,
    estimate_source: EstimateSource,
) -> AIPlan:
    goal = goal or user.goal
    summaries = await _recent_log_summaries(session, user)
    context = await _plan_context(session, user)

    # Let go of the database before asking the model anything.
    #
    # Everything above this line is reads, and SQLAlchemy holds the connection
    # they opened until the transaction ends. Without this the connection sat
    # idle in transaction for the whole of up to three Groq round trips, which
    # on a slow day is tens of seconds. The default pool is five connections
    # plus ten overflow per worker with a thirty second checkout timeout, so a
    # handful of people asking for a plan at once could starve every other
    # request in the app of a connection, including the ones that have nothing
    # to do with plans.
    #
    # Safe to commit rather than roll back: there is nothing pending, and
    # expire_on_commit is False on this factory, so `user` stays usable below
    # instead of trying to refresh itself from a connection we have just
    # returned.
    await session.commit()

    try:
        result = await ai.generate_plan(
            PlanRequest(goal=goal, timezone=user.timezone, recent_logs=summaries, context=context)
        )
    except GroqResponseError as exc:
        logger.warning("Plan generation failed", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Plan generation is unavailable, try again shortly.",
        ) from exc

    generated_plan = result.model_dump(mode="json", exclude={"model"})
    for day in generated_plan["days"]:
        for meal in day["meals"]:
            meal["estimate_source"] = estimate_source

    plan = AIPlan(user_id=user.id, goal=goal, generated_plan=generated_plan, model=result.model)
    session.add(plan)
    await session.commit()
    return plan


async def list_plans(session: AsyncSession, user: User) -> list[AIPlan]:
    rows = await session.scalars(
        select(AIPlan).where(AIPlan.user_id == user.id).order_by(AIPlan.created_at.desc()).limit(20)
    )
    return list(rows)


async def load_plan(session: AsyncSession, user: User, plan_id: uuid.UUID) -> AIPlan:
    plan = await session.scalar(
        select(AIPlan).where(AIPlan.id == plan_id, AIPlan.user_id == user.id)
    )
    if plan is None:
        # 404 rather than 403 for someone else's plan: no reason to confirm
        # that an id exists.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return plan


async def delete_plan(session: AsyncSession, user: User, plan_id: uuid.UUID) -> None:
    plan = await load_plan(session, user, plan_id)
    await session.delete(plan)
    await session.commit()
