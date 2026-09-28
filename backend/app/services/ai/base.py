"""The AI seam.

A Protocol rather than a module-level flag, for two reasons: tests can swap an
implementation through `app.dependency_overrides` with no monkeypatching, and
the type checker enforces that the stub and the real client stay
interchangeable instead of leaving that a runtime hope.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.services.ai.schemas import (
    CalorieAdjustRequest,
    CalorieAdjustResult,
    PhotoCalorieEstimate,
    PlanRequest,
    PlanResult,
)


@runtime_checkable
class AIService(Protocol):
    async def adjust_calories(self, req: CalorieAdjustRequest) -> CalorieAdjustResult: ...

    async def generate_plan(self, req: PlanRequest) -> PlanResult: ...

    # image is the raw file bytes, content_type is whatever _sniff decided from
    # the magic bytes (never the client's declared header). Raw rather than
    # wrapped in a request model: a base64 blob has nothing left to validate
    # once the caller has already checked it is a real JPEG/PNG/WebP.
    async def estimate_from_photo(self, image: bytes, content_type: str) -> PhotoCalorieEstimate: ...
