"""Calories burned, entered by hand.

A single number per day that the dashboard subtracts from what was eaten. There
is no estimation and no device integration here on purpose: the figure comes off
the user's own watch or treadmill, and inventing our own estimate for it would
be guessing at something they already know.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.services.insights import today_for
from app.api.deps import CurrentUser, SessionDep
from app.models import BurnLog, User
from app.schemas.burn import BurnOut, BurnUpsert

router = APIRouter(prefix="/burn", tags=["burn"])

# How much history the client shows beside the calorie chart.
DEFAULT_WINDOW_DAYS = 14
MAX_WINDOW_DAYS = 90




@router.put("", response_model=BurnOut)
async def set_burn(payload: BurnUpsert, session: SessionDep, user: CurrentUser) -> BurnLog:
    """Set, or overwrite, the burn for a day.

    A PUT rather than a POST because it is idempotent: there is one number per
    day, and sending it twice leaves the same state rather than stacking two
    entries. The upsert is one statement, so two devices saving at once cannot
    both insert and trip the unique index.
    """
    day = payload.day or today_for(user)

    stmt = (
        insert(BurnLog)
        .values(user_id=user.id, day=day, calories=payload.calories)
        .on_conflict_do_update(
            index_elements=["user_id", "day"],
            set_={"calories": payload.calories, "updated_at": dt.datetime.now(dt.UTC)},
        )
        .returning(BurnLog)
    )
    entry = (await session.scalars(stmt)).one()
    await session.commit()
    return entry


@router.get("", response_model=list[BurnOut])
async def list_burn(
    session: SessionDep,
    user: CurrentUser,
    days: int = Query(default=DEFAULT_WINDOW_DAYS, ge=1, le=MAX_WINDOW_DAYS),
) -> list[BurnLog]:
    start = today_for(user) - dt.timedelta(days=days - 1)
    rows = await session.scalars(
        select(BurnLog)
        .where(BurnLog.user_id == user.id, BurnLog.day >= start)
        .order_by(BurnLog.day.desc())
    )
    return list(rows)


@router.get("/today", response_model=BurnOut | None)
async def get_today(session: SessionDep, user: CurrentUser) -> BurnLog | None:
    """What the log screen prefills with. Null when nothing has been entered,
    which is different from a deliberate zero and the client shows it as such."""
    return await session.scalar(
        select(BurnLog).where(BurnLog.user_id == user.id, BurnLog.day == today_for(user))
    )


@router.delete("/{day}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_burn(day: dt.date, session: SessionDep, user: CurrentUser) -> Response:
    """Remove a day's entry.

    Distinct from setting it to zero: zero asserts that nothing was burned, and
    deleting says it was never recorded. The dashboard treats them the same, but
    the user should still be able to take back an entry they did not mean.
    """
    entry = await session.scalar(
        select(BurnLog).where(BurnLog.user_id == user.id, BurnLog.day == day)
    )
    if entry is not None:
        await session.delete(entry)
        await session.commit()
    # 204 either way. Deleting something already absent is not an error worth
    # telling the caller about.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
