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
    PlanRequest,
    PlanResult,
)


@runtime_checkable
class AIService(Protocol):
    async def adjust_calories(self, req: CalorieAdjustRequest) -> CalorieAdjustResult: ...

    async def generate_plan(self, req: PlanRequest) -> PlanResult: ...
