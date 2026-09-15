"""v1 router aggregation."""

from fastapi import APIRouter

from app.api.v1 import auth, catalog, insights, logs

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(catalog.router)
api_router.include_router(logs.router)
api_router.include_router(insights.router)

__all__ = ["api_router"]
