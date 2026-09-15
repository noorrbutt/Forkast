"""FastAPI application entrypoint.

Run it bound to all interfaces, not loopback, or a phone running Expo Go will
not be able to reach it:

    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
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
        "Food log CRUD and auth are real; dashboard and streaks are placeholders "
        "served from the seed snapshot, and the Groq integration is a TODO stub."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Unauthenticated liveness check, handy for confirming the phone can
    actually reach the laptop before debugging anything else."""
    return {"status": "ok", "ai_provider": settings.ai_provider.value}
