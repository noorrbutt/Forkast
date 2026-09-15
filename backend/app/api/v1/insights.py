"""Dashboard, streaks, profile and AI plans.

Dashboard and streaks are placeholders served from the seed snapshot. Plans are
real: the logs are really read, the plan is really stored, and only the text
generation itself comes from the stubbed AI service.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.models import AIPlan, FoodCategory, FoodLog, User
from app.schemas.auth import UserOut, UserUpdate
from app.schemas.insights import (
    PLACEHOLDER_SOURCE,
    BurnEquivalents,
    DashboardOut,
    PlanCreate,
    PlanOut,
    StreaksOut,
)
from app.seed.snapshot import read_snapshot
from app.services.ai.base import AIService
from app.services.ai.deps import get_ai_service
from app.services.ai.schemas import PlanLogSummary, PlanRequest

router = APIRouter(tags=["insights"])

AIDep = Annotated[AIService, Depends(get_ai_service)]

# How many recent logs to hand the planner. Enough to spot a pattern, small
# enough to keep the prompt cheap once a real model is behind it.
PLAN_LOG_WINDOW = 30

_EMPTY_DASHBOARD = DashboardOut(
    junk_ratio=0.0,
    total_calories=0,
    logs_count=0,
    calories_by_day=[],
    top_category=None,
    top_restaurant=None,
    best_fun_meals=[],
    burn_equivalents=BurnEquivalents(walking_minutes=0, running_minutes=0, cycling_minutes=0),
)


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
async def dashboard(user: CurrentUser) -> DashboardOut:
    # TODO: replace with real aggregation over food_logs. See the module
    # docstring for why this reads a snapshot for now.
    snapshot = read_snapshot()
    if snapshot is None or "dashboard" not in snapshot:
        return _EMPTY_DASHBOARD
    return DashboardOut.model_validate({**snapshot["dashboard"], "source": PLACEHOLDER_SOURCE})


@router.get("/streaks", response_model=StreaksOut)
async def streaks(user: CurrentUser) -> StreaksOut:
    # TODO: replace with a real on the fly computation from food_logs, bucketed
    # into calendar days in the user's own timezone.
    snapshot = read_snapshot()
    if snapshot is None or "streaks" not in snapshot:
        return StreaksOut(
            current_streak=0,
            longest_streak=0,
            last_junk_date=None,
            message="No logs yet. Your first one starts the streak.",
        )
    return StreaksOut.model_validate({**snapshot["streaks"], "source": PLACEHOLDER_SOURCE})


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
    except NotImplementedError as exc:
        # The Groq implementation is still a stub. Say so plainly instead of
        # returning a 500 with no explanation.
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
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
