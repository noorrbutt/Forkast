"""The jobs queue: enqueue, claim, finish, retry.

A job is a row in `jobs` (app/models/job.py). The whole design rests on two
properties of PostgreSQL, so there is no broker to run:

Enqueueing is an INSERT on the caller's own session and is never committed
here. Whatever made the job necessary commits it, so the two land together or
not at all.

Claiming is one UPDATE over a SELECT ... FOR UPDATE SKIP LOCKED. A row one
claimer has locked is invisible to every other claimer rather than waited on,
so two workers polling at the same instant each get different rows, never the
same one twice.

A handler that raises is retried after an exponential backoff with jitter, and
moved to dead_letter once it has used max_attempts. A row left "running" by a
worker that died is put back by the next claim once it is job_stale_seconds
old, and that counts as one of its attempts, so a job that crashes the process
every time still ends in dead_letter instead of looping forever.

Handlers run at least once, not exactly once: a worker can finish a handler and
die before marking the row done. Every handler has to be safe to repeat.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import logging
import random
import uuid
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Job
from app.models.base import new_uuid7
from app.models.enums import JobStatus

logger = logging.getLogger(__name__)

REFINE_CALORIE_ESTIMATE = "refine_calorie_estimate"
SEND_EMAIL = "send_email"

# The longest last_error kept. A traceback-sized message is no more useful in
# a row than its first line, and an unbounded one is a row that grows forever.
_MAX_ERROR_LENGTH = 2000


@dataclasses.dataclass(frozen=True)
class ClaimedJob:
    id: uuid.UUID
    kind: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int
    # The claim's own token: finishing a job is conditional on it still being
    # the claim this worker made, so a worker that was presumed dead and then
    # woke up cannot overwrite the result of the one that took over.
    locked_at: dt.datetime


@dataclasses.dataclass(frozen=True)
class JobContext:
    """What a handler gets besides its payload."""

    factory: async_sessionmaker[AsyncSession]
    ai: Any = None


Handler = Callable[[Mapping[str, Any], JobContext], Awaitable[None]]


def enqueue(
    session: AsyncSession,
    kind: str,
    payload: Mapping[str, Any],
    *,
    max_attempts: int | None = None,
    run_at: dt.datetime | None = None,
) -> Job:
    """Add a job to the caller's transaction. Deliberately not committed here."""
    job = Job(
        # Set here rather than left to the column default, so the caller has
        # the id before any flush and can hand it to run_now.
        id=new_uuid7(),
        kind=kind,
        payload=dict(payload),
        status=JobStatus.pending,
        attempts=0,
        max_attempts=max_attempts or get_settings().job_max_attempts,
    )
    if run_at is not None:
        job.run_at = run_at
    session.add(job)
    return job


def backoff_seconds(attempts: int, *, rng: random.Random | None = None) -> float:
    """How long to wait before the next try, after `attempts` failures.

    base * 2^attempts, plus a random extra of up to half that. The jitter is
    what stops every job that failed in the same outage from coming back in
    the same second and causing the next one.
    """
    settings = get_settings()
    delay = settings.job_backoff_base_seconds * (2**attempts)
    delay += (rng or random).uniform(0, delay / 2)
    return min(delay, settings.job_backoff_max_seconds)


async def _requeue_stale(session: AsyncSession) -> None:
    """Put back rows whose worker is presumed dead, counting it as a failure."""
    stale_before = func.now() - dt.timedelta(seconds=get_settings().job_stale_seconds)
    attempts = Job.attempts + 1
    await session.execute(
        update(Job)
        .where(Job.status == JobStatus.running, Job.locked_at < stale_before)
        .values(
            attempts=attempts,
            # dead_letter once out of attempts, pending otherwise.
            status=case(
                (attempts >= Job.max_attempts, JobStatus.dead_letter.value),
                else_=JobStatus.pending.value,
            ),
            locked_at=None,
            run_at=func.now(),
            last_error="worker lost while running (no heartbeat within job_stale_seconds)",
        )
        .execution_options(synchronize_session=False)
    )


async def claim(
    factory: async_sessionmaker[AsyncSession],
    *,
    limit: int = 1,
    job_ids: list[uuid.UUID] | None = None,
) -> list[ClaimedJob]:
    """Atomically take up to `limit` due jobs, marking them running.

    One transaction: stale rows are put back first, then the due rows are
    selected FOR UPDATE SKIP LOCKED and flipped to running by the same
    statement. `job_ids` narrows it to particular jobs, which is how a request
    runs the job it just enqueued without racing a worker for it.
    """
    async with factory() as session:
        await _requeue_stale(session)

        due = (
            select(Job.id)
            .where(Job.status == JobStatus.pending, Job.run_at <= func.now())
            .order_by(Job.run_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        if job_ids is not None:
            due = due.where(Job.id.in_(job_ids))

        rows = (
            await session.execute(
                update(Job)
                .where(Job.id.in_(due.scalar_subquery()))
                .values(status=JobStatus.running, locked_at=func.clock_timestamp())
                .returning(
                    Job.id, Job.kind, Job.payload, Job.attempts, Job.max_attempts, Job.locked_at
                )
                .execution_options(synchronize_session=False)
            )
        ).all()
        await session.commit()
    return [ClaimedJob(*row) for row in rows]


async def complete(factory: async_sessionmaker[AsyncSession], job: ClaimedJob) -> None:
    values: dict[str, Any] = {"status": JobStatus.done, "locked_at": None}
    if job.kind == SEND_EMAIL:
        # The payload holds a live one-time token. The tokens table only ever
        # stores a hash of it, so keeping the raw value here after delivery
        # would quietly undo that.
        values["payload"] = {}
    async with factory() as session:
        await session.execute(
            update(Job)
            .where(Job.id == job.id, Job.locked_at == job.locked_at)
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        await session.commit()


async def release(factory: async_sessionmaker[AsyncSession], job: ClaimedJob) -> None:
    """Hand a claimed job back untouched, as if it had never been claimed.

    For a worker shutting down mid-job: the job did not fail, so it does not
    spend an attempt or wait out a backoff.
    """
    async with factory() as session:
        await session.execute(
            update(Job)
            .where(Job.id == job.id, Job.locked_at == job.locked_at)
            .values(status=JobStatus.pending, locked_at=None, run_at=func.now())
            .execution_options(synchronize_session=False)
        )
        await session.commit()


async def fail(
    factory: async_sessionmaker[AsyncSession],
    job: ClaimedJob,
    error: BaseException | str,
    *,
    rng: random.Random | None = None,
) -> JobStatus:
    """Record a failed run, and either schedule the retry or dead-letter it."""
    attempts = job.attempts + 1
    message = error if isinstance(error, str) else f"{type(error).__name__}: {error}"
    values: dict[str, Any] = {
        "attempts": attempts,
        "locked_at": None,
        "last_error": message[:_MAX_ERROR_LENGTH],
    }
    if attempts >= job.max_attempts:
        values["status"] = JobStatus.dead_letter
        if job.kind == SEND_EMAIL:
            values["payload"] = {}
    else:
        values["status"] = JobStatus.pending
        values["run_at"] = func.now() + dt.timedelta(seconds=backoff_seconds(attempts, rng=rng))
    async with factory() as session:
        await session.execute(
            update(Job)
            .where(Job.id == job.id, Job.locked_at == job.locked_at)
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        await session.commit()
    return values["status"]


async def run_claimed(
    job: ClaimedJob, context: JobContext, handlers: Mapping[str, Handler] | None = None
) -> JobStatus:
    """Run one claimed job's handler and record how it went. Never raises."""
    handler = (handlers if handlers is not None else default_handlers()).get(job.kind)
    try:
        if handler is None:
            raise LookupError(f"no handler for job kind {job.kind!r}")
        await handler(job.payload, context)
    except Exception as exc:
        logger.warning("job_failed id=%s kind=%s", job.id, job.kind, exc_info=True)
        return await fail(context.factory, job, exc)
    await complete(context.factory, job)
    return JobStatus.done


async def run_now(job_id: uuid.UUID, context: JobContext) -> None:
    """Run a job that was just enqueued and committed, right here.

    This is how a request keeps the old "lands a moment after the response"
    behaviour: the route schedules this behind its response. It is only a fast
    path. The row is already durable, so if this process dies first, or a
    worker happens to claim the row first, the worker runs it instead; SKIP
    LOCKED means the two can never both have it.
    """
    try:
        for job in await claim(context.factory, limit=1, job_ids=[job_id]):
            await run_claimed(job, context)
    except Exception:
        # The job is still in the table either way; a worker will get it.
        logger.warning("job_run_now_failed id=%s", job_id, exc_info=True)


def default_handlers() -> dict[str, Handler]:
    # Imported here: the handlers live with the code they drive, and those
    # modules import this one to enqueue.
    from app.services.job_handlers import HANDLERS

    return HANDLERS


async def queue_stats(session: AsyncSession) -> dict[str, Any]:
    """Queue depth by kind, plus how much is running and dead-lettered."""
    rows = (
        await session.execute(
            select(Job.status, Job.kind, func.count())
            .where(Job.status != JobStatus.done)
            .group_by(Job.status, Job.kind)
        )
    ).all()
    pending: dict[str, int] = {}
    dead_letter: dict[str, int] = {}
    running = 0
    for status, kind, count in rows:
        if status is JobStatus.pending:
            pending[kind] = count
        elif status is JobStatus.dead_letter:
            dead_letter[kind] = count
        else:
            running += count
    return {
        "pending": sum(pending.values()),
        "pending_by_kind": pending,
        "running": running,
        "dead_letter": sum(dead_letter.values()),
        "dead_letter_by_kind": dead_letter,
    }
