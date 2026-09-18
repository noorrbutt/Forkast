"""FastAPI application entrypoint.

Run it bound to all interfaces, not loopback, or a phone running Expo Go will
not be able to reach it:

    uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload

Port 8010 rather than the usual 8000, which is taken by another project on this
machine. Windows lets two processes bind the same port, so the clash shows up as
requests being answered by the wrong server rather than as a bind error.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.config import get_settings
from app.middleware import BodySizeLimitMiddleware, SecurityHeadersMiddleware

settings = get_settings()

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

app.include_router(api_router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Unauthenticated liveness check, handy for confirming the phone can
    actually reach the laptop before debugging anything else."""
    return {"status": "ok", "ai_provider": settings.ai_provider.value}
