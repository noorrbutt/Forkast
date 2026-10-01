"""Dashboard, streaks, profile and AI plans.

Dashboard and streaks are computed from food_logs on every request, bucketed
into the user's own calendar days; see services/insights.py for why that
matters. Plans read the real log history and store the result
(services/plans.py), and only the text generation comes from the AI seam.

The profile half is everything addressed at /me: reading it, editing it,
changing the password, the profile picture, and closing the account. Its logic
lives in services/profile.py.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials
from starlette.responses import StreamingResponse

from app.api.deps import CurrentUser, RateLimiterDep, SessionDep, bearer_scheme

# Re-verification on an email change is the same mechanism registration
# already uses -- issue a token, send the link -- so the sender is reused
# rather than rebuilt here, after commit, from a background task.
from app.api.v1.auth import SessionFactoryDep, run_job_behind_response
from app.config import get_settings
from app.models import MAX_AVATAR_BYTES, AIPlan, User
from app.schemas.auth import AccountDelete, PasswordChange, UserOut, UserUpdate
from app.schemas.insights import (
    DashboardOut,
    PlanCreate,
    PlanOut,
    ReminderSignalOut,
    StreaksOut,
    WeeklyDigestOut,
)
from app.services import plans as plans_service
from app.services import profile as profile_service
from app.services.ai.base import AIService
from app.services.ai.deps import EstimateSource, get_ai_service, get_estimate_source
from app.services.google import GoogleAuthError, verify_google_id_token
from app.services.images import check_upload
from app.services.insights import (
    build_dashboard,
    build_reminder_signal,
    build_weekly_digest,
    compute_streaks,
)
from app.services.rate_limit import account_identity
from app.services.security import decode_access_token

router = APIRouter(tags=["insights"])

AIDep = Annotated[AIService, Depends(get_ai_service)]
EstimateSourceDep = Annotated[EstimateSource, Depends(get_estimate_source)]
CallerToken = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]


def _plan_out(plan: AIPlan, estimate_source: EstimateSource) -> PlanOut:
    output = PlanOut.model_validate(plan)
    return output.model_copy(update={"estimate_source": estimate_source})


@router.get("/me", response_model=UserOut)
async def read_me(user: CurrentUser) -> User:
    return user


@router.get("/me/export")
async def export_me(
    session: SessionDep,
    user: CurrentUser,
    limiter: RateLimiterDep,
    format: Literal["json", "csv"] = Query(default="json"),
) -> Response:
    """Return the caller's account and content as a file attachment.

    The response is deliberately a plain file download rather than a webpage, so
    it is easy to hand to a regulator or to the user themselves without any
    browser UI around it. Nothing in it includes password_hash or google_sub,
    and the logs leave the photo bytes out.
    """
    await limiter.hit("data-export", account_identity(user.id), limit=5, window_seconds=60 * 60)

    export = await profile_service.build_export(session, user)
    filename = f"forkast-export-{dt.date.today().isoformat()}"
    if format == "json":
        return Response(
            content=export.model_dump_json(indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}.json"'},
        )
    return StreamingResponse(
        iter([profile_service.export_as_csv(export)]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )


@router.patch("/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    session: SessionDep,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
    limiter: RateLimiterDep,
    factory: SessionFactoryDep,
) -> User:
    """Apply exactly the fields the caller sent, including the ones set to null.

    An email change also unverifies the account and mails a fresh link to the
    new address; see profile_service.update_profile.
    """
    email_job_id = await profile_service.update_profile(session, limiter, user, payload)
    if email_job_id is not None:
        run_job_behind_response(background_tasks, email_job_id, factory)
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    payload: AccountDelete,
    session: SessionDep,
    user: CurrentUser,
    limiter: RateLimiterDep,
) -> Response:
    """Delete the account and everything belonging to it.

    Irreversible, so the caller proves it is the account holder and not someone
    holding an unlocked phone. Which proof depends on what the account has: a
    password if it has one, and otherwise a fresh Google ID token, because an
    account created through Google has no password and asking for one would
    either make it undeletable or make the session alone enough. AccountDelete
    has already refused a body carrying both or neither.
    """
    await profile_service.throttle_password_check(limiter, user)

    if payload.password is not None:
        await profile_service.confirm_deletion_by_password(user, payload.password)
    else:
        assert payload.id_token is not None  # noqa: S101 - guaranteed by AccountDelete
        try:
            identity = await verify_google_id_token(payload.id_token)
        except GoogleAuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"{exc} Nothing was deleted.",
            ) from exc
        profile_service.confirm_deletion_by_google(user, identity)

    await profile_service.delete_account(session, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _caller_session_id(credentials: HTTPAuthorizationCredentials | None) -> uuid.UUID | None:
    """Which of the account's sessions is the one making this request.

    CurrentUser has already proved this token is valid, so reading it again is
    not a second check; it is the only way the handler learns its own session id
    without the user row carrying it.
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
    await profile_service.throttle_password_check(limiter, user)
    await profile_service.change_password(
        session,
        user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        caller_session=_caller_session_id(credentials),
    )
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
    # One byte of headroom, so check_upload can tell "on the limit" from "over".
    data = await file.read(MAX_AVATAR_BYTES + 1)
    # The declared type is whatever the client typed. These bytes are served
    # back later with a content type of their own, so the signature decides.
    content_type = check_upload(data, max_bytes=MAX_AVATAR_BYTES, noun="Avatars")
    await profile_service.set_avatar(session, user, data, content_type)
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
    avatar = await profile_service.get_avatar(session, user)
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
    await profile_service.delete_avatar(session, user)
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


@router.get("/insights/weekly-digest", response_model=WeeklyDigestOut)
async def weekly_digest(session: SessionDep, user: CurrentUser) -> WeeklyDigestOut:
    return await build_weekly_digest(session, user)


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
    # It used to be keyed on the peer address as well as the account. That is
    # the one thing this limit must not do: the caller is already
    # authenticated, so the address adds nothing about who they are, and
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
    plan = await plans_service.create_plan(session, ai, user, payload.goal, estimate_source)
    return _plan_out(plan, estimate_source)


@router.get("/plans", response_model=list[PlanOut])
async def list_plans(
    session: SessionDep, user: CurrentUser, estimate_source: EstimateSourceDep
) -> list[PlanOut]:
    return [
        _plan_out(plan, estimate_source) for plan in await plans_service.list_plans(session, user)
    ]


@router.get("/plans/{plan_id}", response_model=PlanOut)
async def get_plan(
    plan_id: uuid.UUID, session: SessionDep, user: CurrentUser, estimate_source: EstimateSourceDep
) -> PlanOut:
    return _plan_out(await plans_service.load_plan(session, user, plan_id), estimate_source)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(plan_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    await plans_service.delete_plan(session, user, plan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
