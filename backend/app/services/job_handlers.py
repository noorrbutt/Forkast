"""What each kind of job does. See services/jobs.py for how they are run.

Each handler takes the job's payload and a JobContext, raises to ask for a
retry, and must be safe to run more than once for the same payload.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from app.services import jobs
from app.services.ai.deps import get_ai_service
from app.services.logs import refine_estimate


async def refine_calorie_estimate(payload: Mapping[str, Any], context: jobs.JobContext) -> None:
    """Idempotent by way of refine_estimate, which leaves a refined row alone."""
    await refine_estimate(
        uuid.UUID(payload["log_id"]),
        int(payload["category_id"]),
        context.ai if context.ai is not None else get_ai_service(),
        context.factory,
    )


HANDLERS: dict[str, jobs.Handler] = {
    jobs.REFINE_CALORIE_ESTIMATE: refine_calorie_estimate,
}
