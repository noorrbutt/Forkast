"""Dashboard, streaks, profile and AI plans.

All real now. Dashboard and streaks are computed from food_logs on every
request, bucketed into the user's own calendar days; see services/insights.py
for why that matters. Plans read the real log history and store the result, and
only the text generation comes from the AI seam.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.models import AIPlan, FoodCategory, FoodLog, User
from app.schemas.auth import UserOut, UserUpdate
from app.schemas.insights import DashboardOut, PlanCreate, PlanOut, StreaksOut
from app.services.ai.base import AIService
from app.services.ai.deps import get_ai_service
from app.services.ai.groq_service import GroqResponseError
from app.services.ai.schemas import PlanLogSummary, PlanRequest
from app.services.insights import build_dashboard, compute_streaks

router = APIRouter(tags=["insights"])

AIDep = Annotated[AIService, Depends(get_ai_service)]

# How many recent logs to hand the planner. Enough to spot a pattern, small
# enough to keep the prompt cheap once a real model is behind it.
PLAN_LOG_WINDOW = 30



@router.get("/me", response_model=UserOut)
async def read_me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(payload: UserUpdate, session: SessionDep, user: CurrentUser) -> User:
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is not None:
            setattr(user, field, value)
    await session.commit()
    return user


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(session: SessionDep, user: CurrentUser) -> DashboardOut:
    return await build_dashboard(session, user)


@router.get("/streaks", response_model=StreaksOut)
async def streaks(session: SessionDep, user: CurrentUser) -> StreaksOut:
    return await compute_streaks(session, user)


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
async def create_plan(
    payload: PlanCreate, session: SessionDep, user: CurrentUser, ai: AIDep
) -> AIPlan:
    goal = payload.goal or user.goal

    recent = await session.scalars(
        select(FoodLog)
        .where(FoodLog.user_id == user.id)
        .order_by(FoodLog.created_at.desc())
        .limit(PLAN_LOG_WINDOW)
        .options(selectinload(FoodLog.category).selectinload(FoodCategory.cuisine))
    )
    logs = list(recent)

    summaries = [
        PlanLogSummary(
            dish_name=log.dish_name,
            category_name=log.category.name,
            cuisine_name=log.category.cuisine.name,
            is_junk=log.category.is_junk,
            estimated_calories=log.estimated_calories,
            logged_at=log.created_at,
        )
        for log in logs
    ]

    try:
        result = await ai.generate_plan(
            PlanRequest(goal=goal, timezone=user.timezone, recent_logs=summaries)
        )
    except GroqResponseError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The plan generator is unavailable: {exc}",
        ) from exc

    plan = AIPlan(
        user_id=user.id,
        goal=goal,
        generated_plan=result.model_dump(mode="json", exclude={"model"}),
        model=result.model,
    )
    session.add(plan)
    await session.commit()
    return plan


@router.get("/plans", response_model=list[PlanOut])
async def list_plans(session: SessionDep, user: CurrentUser) -> list[AIPlan]:
    rows = await session.scalars(
        select(AIPlan).where(AIPlan.user_id == user.id).order_by(AIPlan.created_at.desc()).limit(20)
    )
    return list(rows)
