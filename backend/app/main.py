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

settings = get_settings()

app = FastAPI(
    title="Forkast API",
    version="0.1.0",
    description=(
        "Food logging, calorie forecasting and AI driven meal planning. "
        "Auth, food log CRUD, search, the dashboard and streaks are all real, "
        "with streak days bucketed in each user's own timezone. The Groq "
        "integration is still a TODO stub: AI_PROVIDER=groq answers 501, and "
        "AI_PROVIDER=fake serves the deterministic estimator and planner."
    ),
)

# A wildcard origin and allow_credentials cannot be combined: browsers reject
# the pair outright, so the permissive dev default would silently break every
# request from a web client. Forkast sends a bearer token rather than a cookie,
# so credentials are not needed with a wildcard anyway.
_allow_all_origins = settings.cors_origin_list == ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=not _allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Unauthenticated liveness check, handy for confirming the phone can
    actually reach the laptop before debugging anything else."""
    return {"status": "ok", "ai_provider": settings.ai_provider.value}
