"""FastAPI application entrypoint.

Run it bound to all interfaces, not loopback, or a phone running Expo Go will
not be able to reach it:

    uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload

Port 8010 rather than the usual 8000, which is taken by another project on this
machine. Windows lets two processes bind the same port, so the clash shows up as
requests being answered by the wrong server rather than as a bind error.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.deps import SessionDep
from app.api.v1 import api_router
from app.config import AIProvider, get_settings
from app.db import get_session
from app.middleware import (
    BodySizeLimitMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)
from app.services import circuit_breaker, jobs
from app.services.ai.deps import get_ai_service
from app.web import router as web_router

settings = get_settings()
logger = logging.getLogger(__name__)

# Whether the configured Groq models answered the startup probe, text and
# vision tracked separately -- Groq has retired one without the other before
# (see groq_service's module docstring), and a deploy with a working text
# model and a dead vision model should report photos as degraded without
# looking fully down. Both are None until the background probe finishes, so
# /ready can tell "still checking" apart from "checked and it's down" instead
# of reporting one as the other for however long the first call takes.
ai_text_probe_ok: bool | None = None
ai_vision_probe_ok: bool | None = None


async def _probe_ai_in_background() -> None:
    """Check both models without blocking startup on it.

    get_settings() already fails fast -- and synchronously, before the app
    even starts -- when AI_PROVIDER=groq has no key, because that is a config
    mistake no request can route around. This is the other failure mode: the
    key is fine but a model itself is down or was deprecated out from under
    the config, same as the .env.example warning about Groq retiring models
    without notice. Logging and food search do not touch the model at all,
    and log creation already falls back to a provisional estimate when the
    call fails, so there is no reason an upstream outage should also take
    down login and every non-AI route with it.
    """
    global ai_text_probe_ok, ai_vision_probe_ok
    try:
        result = await get_ai_service().probe()
    except Exception:
        ai_text_probe_ok = False
        ai_vision_probe_ok = False
        logger.warning(
            "AI_PROVIDER is groq but the startup probe could not reach Groq at all; "
            "serving degraded (provisional estimates only) until it recovers.",
            exc_info=True,
        )
    else:
        ai_text_probe_ok = result.text_ok
        ai_vision_probe_ok = result.vision_ok
        if not (result.text_ok and result.vision_ok):
            logger.warning(
                "AI_PROVIDER is groq but the startup probe found a model missing "
                "(text_ok=%s, vision_ok=%s); the affected feature will serve "
                "provisional estimates until it recovers.",
                result.text_ok,
                result.vision_ok,
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.ai_provider is AIProvider.groq:
        task = asyncio.create_task(_probe_ai_in_background())
        try:
            yield
        finally:
            task.cancel()
    else:
        yield


app = FastAPI(
    title="Forkast API",
    version="0.1.0",
    # The interactive docs enumerate every route, schema and example, which is
    # free reconnaissance on a public host and genuinely useful on a laptop.
    # ENVIRONMENT=production turns all three off together.
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
    description=(
        "Food logging, calorie forecasting and AI driven meal planning. "
        "Auth, food log CRUD, search, the dashboard and streaks are all real, "
        "with streak days bucketed in each user's own timezone. AI_PROVIDER "
        "selects the estimator and planner: groq calls the real API, fake uses "
        "a deterministic local one that needs no key. An upstream AI failure is "
        "reported as 502, since the provider is not this service."
    ),
    lifespan=lifespan,
)

# A wildcard origin and allow_credentials cannot be combined: browsers reject
# the pair outright, so the permissive dev default would silently break every
# request from a web client. Forkast sends a bearer token rather than a cookie,
# so credentials are not needed with a wildcard anyway.
_allow_all_origins = settings.cors_origin_list == ["*"]

# add_middleware prepends, so the LAST one added is the outermost. The order
# below is therefore, from the outside in: security headers, CORS, body limit.
#
# The body limit is innermost on purpose. It used to be outermost, where its 413
# was returned without ever passing back through the other two, so the one
# response most likely to be produced by a hostile or misconfigured client
# carried neither the security headers nor the CORS headers -- which meant a
# browser could not even read the status, and reported it as an opaque network
# failure instead of "your upload was too big".
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_bytes)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=not _allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Outermost, so its headers reach even the responses CORS short-circuits.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(api_router)
# Root-level, not under /api/v1: the well-known paths and the App Links
# fallback paths are dictated by the platforms' own conventions.
app.include_router(web_router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Unauthenticated liveness check, handy for confirming the phone can
    actually reach the laptop before debugging anything else."""
    return {"status": "ok", "ai_provider": settings.ai_provider.value}


@app.get("/ready", tags=["meta"])
async def ready() -> dict[str, str]:
    """Application readiness: the app can talk to Postgres right now.

    The database is the one dependency a request cannot route around, so it
    is still the thing that decides 503 versus 200. Groq is not: an outage
    there degrades AI estimates rather than taking the service down, so it is
    reported as a field on an otherwise-200 response rather than as a failure
    of readiness itself.
    """
    dependency = app.dependency_overrides.get(get_session, get_session)
    try:
        value = dependency()
        if inspect.isasyncgen(value):
            session = await value.__anext__()
            try:
                await session.execute(text("SELECT 1"))
            finally:
                await value.aclose()
        elif inspect.isawaitable(value):
            await value
    except Exception as exc:  # pragma: no cover - DB failure path
        raise HTTPException(status_code=503, detail="Database unavailable") from exc

    def _status(ok: bool | None) -> str:
        if settings.ai_provider is not AIProvider.groq:
            return "not_configured"
        if ok is None:
            return "checking"
        return "ok" if ok else "degraded"

    text_status = _status(ai_text_probe_ok)
    vision_status = _status(ai_vision_probe_ok)
    # "ai" stays as the combined view existing callers already read: ok only
    # when both models are, degraded if either is down, otherwise whichever
    # of not_configured/checking applies to both alike.
    if text_status == vision_status:
        combined_status = text_status
    elif "degraded" in (text_status, vision_status):
        combined_status = "degraded"
    else:
        combined_status = "checking"

    return {
        "status": "ready",
        "ai": combined_status,
        "ai_text": text_status,
        "ai_vision": vision_status,
    }


@app.get("/queue", tags=["meta"])
async def queue(session: SessionDep) -> dict[str, Any]:
    """Jobs queue depth, for whoever is watching the worker.

    Pending is the backlog (by kind too, since a refinement backlog and an
    email backlog mean different things), dead_letter is what gave up and
    needs a person. Unauthenticated like /ready, and like it carries counts
    only: no payloads, which can hold one-time links.
    """
    stats = await jobs.queue_stats(session)
    stats["ai_breaker_open"] = await circuit_breaker.is_open(session)
    return stats
