"""What each kind of job does. See services/jobs.py for how they are run.

Each handler takes the job's payload and a JobContext, raises to ask for a
retry, and must be safe to run more than once for the same payload.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from starlette.concurrency import run_in_threadpool

from app.services import email, jobs
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


# By name rather than by function, so the lookup happens on the email module
# at send time and a test's mock of it applies.
_EMAIL_TEMPLATES = {
    "verify_email": "send_verification_email",
    "reset_password": "send_password_reset_email",
}


async def send_email(payload: Mapping[str, Any], context: jobs.JobContext) -> None:
    """Send one link email. A provider error raises, so the queue retries it.

    Sending twice after a crash between delivery and the job being marked done
    is possible and accepted: email is at-least-once anyway, and the second
    copy carries the same link, so either one works. Nothing else is written.
    """
    sender = getattr(email, _EMAIL_TEMPLATES[payload["template"]])
    await run_in_threadpool(sender, payload["to"], payload["link"])


HANDLERS: dict[str, jobs.Handler] = {
    jobs.REFINE_CALORIE_ESTIMATE: refine_calorie_estimate,
    jobs.SEND_EMAIL: send_email,
}
