"""Dashboard, streaks, profile and AI plans.

All real now. Dashboard and streaks are computed from food_logs on every
request, bucketed into the user's own calendar days; see services/insights.py
for why that matters. Plans read the real log history and store the result, and
only the text generation comes from the AI seam.

The profile half is everything addressed at /me: reading it, editing it,
changing the password, the profile picture, and closing the account.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, RateLimiterDep, SessionDep, bearer_scheme

# The signature check that decides whether an upload really is an image, shared
# with the meal photo route rather than written twice, so the two cannot drift
# into accepting different files from each other.
from app.api.v1.logs import _sniff
from app.config import get_settings
from app.models import (
    MAX_AVATAR_BYTES,
    AIPlan,
    BurnLog,
    FoodCategory,
    FoodLog,
    RefreshToken,
    User,
    UserAvatar,
)
from app.schemas.auth import (
    AccountDelete,
    DataExport,
    ExportBurnLog,
    ExportLog,
    ExportPlan,
    PasswordChange,
    UserOut,
    UserUpdate,
)
from app.schemas.insights import DashboardOut, PlanCreate, PlanOut, ReminderSignalOut, StreaksOut
from app.services.ai.base import AIService
from app.services.ai.deps import EstimateSource, get_ai_service, get_estimate_source
from app.services.ai.groq_service import GroqResponseError
from app.services.ai.schemas import PlanContext, PlanLogSummary, PlanRequest
from app.services.google import GoogleAuthError, verify_google_id_token
from app.services.insights import build_dashboard, build_reminder_signal, compute_streaks
from app.services.rate_limit import account_identity
from app.services.security import (
    decode_access_token,
    hash_password_async,
    verify_password_async,
)

router = APIRouter(tags=["insights"])
logger = logging.getLogger(__name__)

AIDep = Annotated[AIService, Depends(get_ai_service)]
EstimateSourceDep = Annotated[EstimateSource, Depends(get_estimate_source)]


def _plan_out(plan: AIPlan, estimate_source: EstimateSource) -> PlanOut:
    output = PlanOut.model_validate(plan)
    return output.model_copy(update={"estimate_source": estimate_source})


CallerToken = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]

# How many recent logs to hand the planner. Enough to spot a pattern, small
# enough to keep the prompt cheap once a real model is behind it.
PLAN_LOG_WINDOW = 30


@router.get("/me", response_model=UserOut)
async def read_me(user: CurrentUser) -> User:
    return user


@router.get("/me/export", response_model=DataExport)
async def export_me(session: SessionDep, user: CurrentUser, limiter: RateLimiterDep) -> DataExport:
    """Return the caller's account and content as a JSON attachment.

    The response is deliberately a plain file download rather than a webpage, so
    it is easy to hand to a regulator or to the user themselves without any
    browser UI around it. The user row is the public profile shape so it never
    includes password_hash or google_sub, and the nested logs intentionally omit
    photo bytes while still exposing whether a photo exists.
    """
    await limiter.hit(
        "data-export",
        account_identity(user.id),
        limit=5,
        window_seconds=60 * 60,
    )

    log_rows = await session.scalars(
        select(FoodLog)
        .where(FoodLog.user_id == user.id)
        .order_by(FoodLog.created_at.desc())
        .options(selectinload(FoodLog.category), selectinload(FoodLog.restaurant))
    )
    logs = [
        ExportLog(
            id=log.id,
            dish_name=log.dish_name,
            category_name=getattr(log.category, "name", None),
            restaurant_name=getattr(log.restaurant, "name", None),
            estimated_calories=getattr(log, "estimated_calories", None),
            created_at=log.created_at,
            has_photo=bool(getattr(log, "photo", None) is not None),
        )
        for log in log_rows
    ]

    burn_rows = await session.scalars(
        select(BurnLog).where(BurnLog.user_id == user.id).order_by(BurnLog.created_at.desc())
    )
    burn_logs = [
        ExportBurnLog(
            id=burn.id,
            calories=getattr(burn, "calories", None),
            created_at=getattr(burn, "created_at", None),
            note=getattr(burn, "note", None),
        )
        for burn in burn_rows
    ]

    plan_rows = await session.scalars(
        select(AIPlan).where(AIPlan.user_id == user.id).order_by(AIPlan.created_at.desc())
    )
    plans = [
        ExportPlan(
            id=plan.id,
            goal=getattr(plan, "goal", None),
            created_at=plan.created_at,
            model=getattr(plan, "model", None),
            generated_plan=getattr(plan, "generated_plan", {}) or {},
        )
        for plan in plan_rows
    ]

    export = DataExport(user=user, logs=logs, burn_logs=burn_logs, plans=plans)
    return Response(
        content=export.model_dump_json(indent=2),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="forkast-export.json"'},
    )


@router.patch("/me", response_model=UserOut)
async def update_me(payload: UserUpdate, session: SessionDep, user: CurrentUser) -> User:
    """Apply exactly the fields the caller sent, including the ones set to null.

    exclude_unset is what separates "leave this alone" from "clear this", and it
    already does that job on its own. The `if value is not None` this used to
    carry on top of it collapsed the two back together, so PATCH {"daily_
    calorie_target": null} was accepted, answered 200, and changed nothing. That
    is the only way to remove a daily target from the app, so "Clear target" on
    the Profile tab closed the dialog, fired the success haptic and left the
    target exactly where it was, with no way to ever remove it.

    The fields that genuinely cannot take a null are refused by UserUpdate
    before reaching here.
    """
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(user, field, value)
    await session.commit()
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    payload: AccountDelete,
    session: SessionDep,
    user: CurrentUser,
    limiter: RateLimiterDep,
) -> Response:
    """Delete the account and everything belonging to it.

    Every table that holds this user's own data cascades from users: food_logs,
    burn_logs, ai_plans and refresh_tokens. Restaurants deliberately do not.
    They are a shared registry keyed on name and area, so created_by is SET NULL
    and the place survives; removing it would delete a landmark other people
    have logged against because one of them closed their account.

    Cascading the refresh tokens is what ends every other signed in device, so
    there is no need to revoke them separately.
    """
    # Throttled like a login, because that is what it is: a password guess, made
    # by whoever is holding the phone. Without this an unlocked handset is an
    # unlimited offline-speed oracle against the owner's password, and the prize
    # for guessing right is the irreversible deletion of every meal they logged.
    settings = get_settings()
    await limiter.hit(
        "password-check",
        account_identity(user.id),
        limit=settings.login_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )

    # Irreversible, so prove it is the account holder and not someone holding an
    # unlocked phone. Which proof depends on what the account has: a password if
    # it has one, and otherwise a fresh Google ID token, because an account
    # created through Google has no password and asking for one would either
    # make it undeletable or make the session alone enough. AccountDelete has
    # already refused a body carrying both or neither.
    if payload.password is not None:
        if user.password_hash is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This account signs in with Google and has no password, so "
                    "confirm with Google instead. Nothing was deleted."
                ),
            )
        # The same constant time comparison login uses.
        if not await verify_password_async(payload.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="That password does not match, so nothing was deleted.",
            )
    else:
        # A token is only proof if it names this very account. Verifying the
        # signature and stopping there would let anybody with any Google account
        # delete whichever Forkast account their phone happened to be signed in
        # to, which is the opposite of what this check is for.
        assert payload.id_token is not None  # noqa: S101 - guaranteed by AccountDelete
        try:
            identity = await verify_google_id_token(payload.id_token)
        except GoogleAuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"{exc} Nothing was deleted.",
            ) from exc
        if identity.subject != user.google_sub:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="That is a different Google account, so nothing was deleted.",
            )

    await session.delete(user)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _caller_session_id(credentials: HTTPAuthorizationCredentials | None) -> uuid.UUID | None:
    """Which of the account's sessions is the one making this request.

    CurrentUser has already proved this token is valid, so reading it again is
    not a second check; it is the only way the handler learns its own session id
    without the user row carrying it. None means the token could not be read at
    all, and the one caller below turns that into "end every session", so a
    surprise here can only be too strict, never too lax.
    """
    if credentials is None:
        return None
    claims = decode_access_token(credentials.credentials)
    return claims.session_id if claims is not None else None


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChange,
    session: SessionDep,
    user: CurrentUser,
    credentials: CallerToken,
    limiter: RateLimiterDep,
) -> Response:
    """Change the password, and sign every other device out.

    A new password under 8 characters is refused by the schema before any of
    this runs, so a change cannot land a password registration would have
    turned away.
    """
    # Shares the "password-check" bucket with account deletion, so guesses made
    # against one route spend the other's allowance too. They are the same
    # question asked twice, and letting each carry its own budget would simply
    # double the number of tries available.
    settings = get_settings()
    await limiter.hit(
        "password-check",
        account_identity(user.id),
        limit=settings.login_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )

    # An account created through Google has no current password to be asked for,
    # so there is nothing here to change. It is not offered the row in the app
    # either; this is the guard for a request that arrives anyway, and it answers
    # 409 rather than 403 because the request is not wrong about a value, it is
    # wrong about the account.
    if user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account signs in with Google and has no password to change.",
        )

    # The same constant time comparison login uses, and asked for the same
    # reason deletion asks: the session proves the phone, not the person
    # holding it.
    if not await verify_password_async(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That password does not match, so nothing was changed.",
        )

    user.password_hash = await hash_password_async(payload.new_password)

    # Every other session ends here; this one deliberately does not. Someone
    # changing a password is usually reacting to a device they no longer
    # control, so leaving the other sessions alive would defeat the point,
    # while ending this one too would drop the caller at a login screen the
    # moment they proved they knew both passwords.
    #
    # The other sessions' rows are deleted rather than stamped revoked_at, and
    # that is the part worth being careful about. A revoked row is exactly what
    # /auth/refresh reads as a leaked token chain, and its answer to that is to
    # revoke every live token on the account, this caller's included. Marking
    # the other devices revoked would therefore arm a trap: the next time any
    # of them refreshed, the person who had just changed their password would
    # be signed out by it. With no row at all those devices get the same plain
    # 401 a token that never existed gets, and their access tokens stop working
    # immediately, because get_current_user only accepts one whose session still
    # has a live refresh token. The caller's own rows, spent ones included, are
    # left exactly as they were, so reuse detection still guards the chain that
    # is actually in use.
    ending = delete(RefreshToken).where(RefreshToken.user_id == user.id)
    caller_session = _caller_session_id(credentials)
    if caller_session is not None:
        ending = ending.where(RefreshToken.session_id != caller_session)
    await session.execute(ending)

    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/me/avatar", response_model=UserOut)
async def set_avatar(
    session: SessionDep,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
) -> User:
    """Set or replace the profile picture.

    PUT rather than POST: there is one picture per account, so uploading twice
    leaves the same state instead of stacking a second one, which makes a retry
    after a dropped connection safe by construction.
    """
    # Read with one byte of headroom so a file exactly on the limit passes and
    # anything over it is caught here rather than by the CHECK constraint, which
    # would surface as a 500.
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Avatars must be {MAX_AVATAR_BYTES // 1024} KB or smaller.",
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That file was empty.",
        )

    # The declared type is whatever the client typed. These bytes are served
    # back later with a content type of their own, so the signature decides.
    content_type = _sniff(data)
    if content_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Avatars must be JPEG, PNG or WebP.",
        )

    existing = await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user.id))
    if existing is None:
        session.add(
            UserAvatar(
                user_id=user.id,
                content_type=content_type,
                byte_size=len(data),
                data=data,
            )
        )
    else:
        existing.content_type = content_type
        existing.byte_size = len(data)
        existing.data = data

    await session.commit()
    # has_avatar was answered by the SELECT that loaded this user, which ran
    # before the row above existed, so without a re-read the reply would still
    # say there is no picture.
    await session.refresh(user)
    return user


@router.get("/me/avatar")
async def get_avatar(session: SessionDep, user: CurrentUser) -> Response:
    """The image bytes.

    Only ever your own. No route addresses somebody else's picture, so one
    account cannot ask for another's bytes at all.

    Returns the file rather than a URL, which keeps the storage decision behind
    this route: moving the bytes to object storage later becomes a redirect from
    here, and no client changes.
    """
    avatar = await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user.id))
    if avatar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No avatar on this account",
        )

    return Response(
        content=avatar.data,
        media_type=avatar.content_type,
        headers={
            # Unlike a meal photo, this address is stable while its contents are
            # not: replacing the picture reuses the same URL. Held for a day it
            # would keep showing the old face, so it is revalidated every time.
            "Cache-Control": "private, no-cache",
            "Content-Length": str(avatar.byte_size),
        },
    )


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(session: SessionDep, user: CurrentUser) -> Response:
    avatar = await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user.id))
    # Removing a picture that is not there is the state the caller asked for, so
    # it is not an error.
    if avatar is not None:
        await session.delete(avatar)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(session: SessionDep, user: CurrentUser) -> DashboardOut:
    return await build_dashboard(session, user)


@router.get("/streaks", response_model=StreaksOut)
async def streaks(session: SessionDep, user: CurrentUser) -> StreaksOut:
    return await compute_streaks(session, user)


@router.get("/insights/reminder-signal", response_model=ReminderSignalOut)
async def reminder_signal(session: SessionDep, user: CurrentUser) -> ReminderSignalOut:
    return await build_reminder_signal(session, user)


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
async def create_plan(
    payload: PlanCreate,
    session: SessionDep,
    user: CurrentUser,
    ai: AIDep,
    estimate_source: EstimateSourceDep,
    limiter: RateLimiterDep,
) -> AIPlan:
    # The only route that costs real money once Groq is behind it, and the only
    # one where an authenticated user can run up someone else's bill. Keyed on
    # the user id ALONE, because the account is who pays.
    #
    # It used to be keyed on the peer address as well as the account. That is the one thing this limit must not do: the caller is
    # already authenticated, so the address adds nothing about who they are, and
    # moving between wifi and mobile data -- or setting X-Forwarded-For, once a
    # proxy is trusted -- handed the same account a fresh hourly allowance of
    # paid API calls each time.
    settings = get_settings()
    await limiter.hit(
        "plan",
        account_identity(user.id),
        limit=settings.plan_rate_limit,
        window_seconds=settings.plan_rate_window_seconds,
    )

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

    # The same figures the dashboard and streaks screens show, handed to the
    # planner as facts. Without them the model recounts from the raw list and
    # its narrative can contradict the numbers the user is looking at.
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

    context = PlanContext(
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
    )

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
            PlanRequest(
                goal=goal,
                timezone=user.timezone,
                recent_logs=summaries,
                context=context,
            )
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

    plan = AIPlan(
        user_id=user.id,
        goal=goal,
        generated_plan=generated_plan,
        model=result.model,
    )
    session.add(plan)
    await session.commit()
    return _plan_out(plan, estimate_source)


@router.get("/plans", response_model=list[PlanOut])
async def list_plans(
    session: SessionDep, user: CurrentUser, estimate_source: EstimateSourceDep
) -> list[PlanOut]:
    rows = await session.scalars(
        select(AIPlan).where(AIPlan.user_id == user.id).order_by(AIPlan.created_at.desc()).limit(20)
    )
    return [_plan_out(plan, estimate_source) for plan in rows]


async def _load_plan(session: SessionDep, user: CurrentUser, plan_id: uuid.UUID) -> AIPlan:
    plan = await session.scalar(
        select(AIPlan).where(AIPlan.id == plan_id, AIPlan.user_id == user.id)
    )
    if plan is None:
        # 404 rather than 403 for someone else's plan: no reason to confirm
        # that an id exists.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return plan


@router.get("/plans/{plan_id}", response_model=PlanOut)
async def get_plan(
    plan_id: uuid.UUID, session: SessionDep, user: CurrentUser, estimate_source: EstimateSourceDep
) -> PlanOut:
    return _plan_out(await _load_plan(session, user, plan_id), estimate_source)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(plan_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    plan = await _load_plan(session, user, plan_id)
    await session.delete(plan)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
