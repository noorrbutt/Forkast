"""What each kind of job does. See services/jobs.py for how they are run.

Each handler takes the job's payload and a JobContext, raises to ask for a
retry, and must be safe to run more than once for the same payload.
"""

from __future__ import annotations

from app.services.jobs import Handler

HANDLERS: dict[str, Handler] = {}
