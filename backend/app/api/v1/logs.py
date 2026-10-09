"""Food log CRUD, plus the month over month trend read.

The trend lives here rather than beside the dashboard because it is a straight
read over food_logs and nothing else, but it is not addressed under /logs, so
this module exports one router carrying both and the v1 aggregation stays a
single include. What the routes do with a log lives in services/logs.py.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.concurrency import run_in_threadpool

from app.api.deps import CurrentUser, RateLimiterDep, SessionDep
from app.config import get_settings
from app.db import get_session_factory
from app.models import MAX_PHOTO_BYTES, FoodLog
from app.schemas.insights import TrendOut
from app.schemas.logs import FoodLogCreate, FoodLogOut, FoodLogPage, FoodLogUpdate, PhotoEstimateOut
from app.services import jobs
from app.services import logs as logs_service
from app.services.ai.base import AIService
from app.services.ai.deps import EstimateSource, get_ai_service, get_estimate_source
from app.services.images import (
    MAX_THUMBNAIL_EDGE,
    MIN_THUMBNAIL_EDGE,
    check_upload,
    thumbnail,
)
from app.services.insights import build_trend
from app.services.rate_limit import account_identity

logs_router = APIRouter(prefix="/logs", tags=["logs"])
trend_router = APIRouter(tags=["insights"])

# What app.api.v1 includes. Both of the above hang off it, so adding a route
# outside /logs needs no change to the aggregation.
router = APIRouter()

AIDep = Annotated[AIService, Depends(get_ai_service)]
EstimateSourceDep = Annotated[EstimateSource, Depends(get_estimate_source)]

# Injected rather than imported, for the reason get_session_factory's own
# docstring gives: it is a dependency precisely so tests can point it at the
# test database. Calling it directly from a background task would step past
# app.dependency_overrides and open a connection to the real one.
SessionFactoryDep = Annotated["async_sessionmaker[AsyncSession]", Depends(get_session_factory)]


async def _run_refinement(
    background: BackgroundTasks,
    job_id: uuid.UUID,
    ai: AIService,
    factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    log: FoodLog,
) -> None:
    """Run the refinement job this request just committed, once the response
    is out, so the figure still settles a moment after a save.

    Only a fast path. The job is already a row in the jobs table, so if this
    process dies before getting to it, a `python -m app.worker` picks it up;
    the request's own `ai` is used here so a test's override applies to it.
    With SERVERLESS=true it is awaited inline instead (jobs.run_for_request);
    the log is committed either way, so a failure only leaves it provisional.
    """
    await jobs.run_for_request(background, job_id, jobs.JobContext(factory=factory, ai=ai))
    if get_settings().serverless:
        # The job wrote through its own session, so reload the row to answer
        # with the refined figure when it landed (the provisional one if not).
        await session.refresh(log)


def _food_log_out(log: FoodLog, estimate_source: EstimateSource) -> FoodLogOut:
    output = FoodLogOut.model_validate(log)
    return output.model_copy(
        update={
            "estimate_source": estimate_source,
            "refined": log.estimate_refined_at is not None,
        }
    )


@logs_router.post("", response_model=FoodLogOut, status_code=status.HTTP_201_CREATED)
async def create_log(
    payload: FoodLogCreate,
    session: SessionDep,
    user: CurrentUser,
    ai: AIDep,
    estimate_source: EstimateSourceDep,
    factory: SessionFactoryDep,
    background: BackgroundTasks,
    limiter: RateLimiterDep,
    response: Response,
) -> FoodLog:
    log, created, job_id = await logs_service.create_log(session, limiter, user, payload)
    if not created:
        # A retry of a save that already landed: answered from that row, and
        # 200 rather than 201 because nothing new was made.
        response.status_code = status.HTTP_200_OK
    if job_id is not None:
        await _run_refinement(background, job_id, ai, factory, session, log)
    return _food_log_out(log, estimate_source)


@logs_router.post("/estimate-photo", response_model=PhotoEstimateOut)
async def estimate_photo(
    user: CurrentUser,
    ai: AIDep,
    estimate_source: EstimateSourceDep,
    limiter: RateLimiterDep,
    file: Annotated[UploadFile, File()],
) -> PhotoEstimateOut:
    """Read a photo and guess what is on it, without saving anything.

    The camera is the primary way to log a meal now, and nobody should have to
    trust a guess sight unseen: this exists so the app can show what the model
    thinks it saw and let the estimate be confirmed or corrected before it
    becomes a log. There is no category yet at this point, so the calorie
    figure returned here is a preview rather than the number that ends up
    stored -- saving still goes through POST /logs once a category has been
    picked (by search, by a suggested match, or by hand), and that route prices
    the meal the same way it prices every other log, text or photo.

    Declared ahead of GET/PATCH/DELETE /logs/{log_id} in this file on purpose:
    those all capture a single path segment as log_id and FastAPI matches
    routes in declaration order, so a route registered after them would never
    be reached, Starlette would try to parse "estimate-photo" as a UUID first
    and 422 before this function ever ran.

    Gated on `estimate_source` rather than reading settings.ai_provider
    directly, and that is not a style choice: get_estimate_source is a
    dependency, so the test suite's deterministic_ai fixture (conftest.py)
    overrides it straight to "local" for every test regardless of what a
    developer's own .env happens to have AI_PROVIDER set to. Reading the
    setting directly here would silently disagree with which AIService is
    actually injected below and rate-limit, kill-switch and compress against a
    live setting while `ai` itself was quietly the deterministic stub.
    """
    live = estimate_source == "ai"
    await logs_service.guard_photo_estimate(limiter, user, live=live)

    # One byte of headroom, so check_upload can tell "on the limit" from "over".
    data = await file.read(MAX_PHOTO_BYTES + 1)
    content_type = check_upload(data, max_bytes=MAX_PHOTO_BYTES, noun="Photos")
    estimate = await logs_service.estimate_photo(ai, data, content_type, live=live)
    return PhotoEstimateOut(**estimate.model_dump(), estimate_source=estimate_source)


@logs_router.get("", response_model=FoodLogPage)
async def list_logs(
    session: SessionDep,
    user: CurrentUser,
    estimate_source: EstimateSourceDep,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> FoodLogPage:
    rows, total = await logs_service.list_logs(session, user, limit=limit, offset=offset)
    return FoodLogPage(items=[_food_log_out(row, estimate_source) for row in rows], total=total)


@logs_router.get("/{log_id}", response_model=FoodLogOut)
async def get_log(
    log_id: uuid.UUID, session: SessionDep, user: CurrentUser, estimate_source: EstimateSourceDep
) -> FoodLogOut:
    return _food_log_out(await logs_service.load_log(session, user.id, log_id), estimate_source)


@logs_router.patch("/{log_id}", response_model=FoodLogOut)
async def update_log(
    log_id: uuid.UUID,
    payload: FoodLogUpdate,
    session: SessionDep,
    user: CurrentUser,
    ai: AIDep,
    estimate_source: EstimateSourceDep,
    factory: SessionFactoryDep,
    background: BackgroundTasks,
    limiter: RateLimiterDep,
) -> FoodLog:
    updated, job_id = await logs_service.update_log(session, limiter, user, log_id, payload)
    if job_id is not None:
        await _run_refinement(background, job_id, ai, factory, session, updated)
    return _food_log_out(updated, estimate_source)


@logs_router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_log(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    await logs_service.delete_log(session, user, log_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@logs_router.post(
    "/{log_id}/repeat", response_model=FoodLogOut, status_code=status.HTTP_201_CREATED
)
async def repeat_log(
    log_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    estimate_source: EstimateSourceDep,
    limiter: RateLimiterDep,
) -> FoodLog:
    """Log the same thing again, now, without retyping any of it."""
    created = await logs_service.repeat_log(session, limiter, user, log_id)
    return _food_log_out(created, estimate_source)


@logs_router.put("/{log_id}/photo", response_model=FoodLogOut)
async def set_photo(
    log_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    estimate_source: EstimateSourceDep,
    file: Annotated[UploadFile, File()],
    limiter: RateLimiterDep,
) -> FoodLog:
    """Attach or replace the picture on a meal.

    PUT rather than POST: there is one photo per meal, so uploading twice leaves
    the same state instead of stacking a second image. A retry after a dropped
    connection is then safe by construction.
    """
    await limiter.hit(
        "photo-day",
        account_identity(user.id),
        limit=get_settings().photo_daily_limit,
        window_seconds=86400,
    )
    log = await logs_service.load_log(session, user.id, log_id)

    data = await file.read(MAX_PHOTO_BYTES + 1)
    content_type = check_upload(data, max_bytes=MAX_PHOTO_BYTES, noun="Photos")
    await logs_service.set_photo(session, log, data, content_type)
    return _food_log_out(await logs_service.load_log(session, user.id, log_id), estimate_source)


@logs_router.get("/{log_id}/photo")
async def get_photo(
    log_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    w: int | None = Query(default=None, ge=MIN_THUMBNAIL_EDGE, le=MAX_THUMBNAIL_EDGE),
) -> Response:
    """The image bytes.

    Deliberately returns the file rather than a URL. That keeps the storage
    decision behind this route: moving the bytes to object storage later becomes
    a redirect from here, and no client changes.

    `w` asks for a copy no longer than that on its longest edge, for a photo
    drawn at tile size. A query parameter on this route rather than a second
    route, so ownership, the 404s and the cache headers are the same code
    path whichever size is asked for. Resized per request rather than stored:
    the stored photo is already capped at about 1024px, so the work is small,
    and the response is cached by the client for a day like the original.
    """
    photo = await logs_service.get_photo(session, user, log_id)
    content, media_type = photo.data, photo.content_type
    if w is not None:
        resized = await run_in_threadpool(thumbnail, photo.data, w)
        if resized is not None:
            content, media_type = resized
    return Response(
        content=content,
        media_type=media_type,
        headers={
            # The bytes for a given photo never change; a replacement is a new
            # row with a new id, so this is safe to hold onto.
            "Cache-Control": "private, max-age=86400",
            "Content-Length": str(len(content)),
        },
    )


@logs_router.delete("/{log_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(log_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    await logs_service.delete_photo(session, user, log_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@trend_router.get("/trend", response_model=TrendOut)
async def trend(session: SessionDep, user: CurrentUser) -> TrendOut:
    return await build_trend(session, user)


router.include_router(logs_router)
router.include_router(trend_router)
