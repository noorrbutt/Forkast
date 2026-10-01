"""`python -m app.worker`: concurrency and shutdown.

Driven through run_worker with stop/abort events standing in for SIGTERM, since
a test cannot signal its own process without taking pytest down with it.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job
from app.models.enums import JobStatus
from app.services import jobs
from app.worker import run_worker


async def _enqueue(session_factory, count: int) -> list:
    async with session_factory() as db:
        ids = [jobs.enqueue(db, "test", {"n": n}).id for n in range(count)]
        await db.commit()
    return ids


async def _statuses(session: AsyncSession) -> list[JobStatus]:
    session.expire_all()
    return list(await session.scalars(select(Job.status)))


async def test_the_worker_runs_a_backlog_no_more_than_n_at_a_time(
    session_factory, session: AsyncSession
) -> None:
    await _enqueue(session_factory, 9)
    running = peak = finished = 0
    stop = asyncio.Event()

    async def handler(payload, context) -> None:
        nonlocal running, peak, finished
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.05)
        running -= 1
        finished += 1
        if finished == 9:
            stop.set()

    await asyncio.wait_for(
        run_worker(
            jobs.JobContext(factory=session_factory),
            concurrency=3,
            poll_seconds=0.05,
            stop=stop,
            handlers={"test": handler},
        ),
        timeout=15,
    )

    assert finished == 9
    assert peak <= 3
    assert peak > 1, "jobs ran one at a time; concurrency did nothing"
    assert set(await _statuses(session)) == {JobStatus.done}


async def test_a_stop_signal_finishes_in_flight_jobs_and_claims_no_more(
    session_factory, session: AsyncSession
) -> None:
    await _enqueue(session_factory, 3)
    started = asyncio.Event()
    release = asyncio.Event()
    stop = asyncio.Event()
    calls = 0

    async def handler(payload, context) -> None:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()

    worker = asyncio.create_task(
        run_worker(
            jobs.JobContext(factory=session_factory),
            concurrency=1,
            poll_seconds=0.05,
            stop=stop,
            handlers={"test": handler},
        )
    )
    await asyncio.wait_for(started.wait(), timeout=5)
    stop.set()
    await asyncio.sleep(0.1)
    assert not worker.done(), "the worker quit with a job still running"

    release.set()
    await asyncio.wait_for(worker, timeout=5)

    assert calls == 1
    assert sorted(await _statuses(session)) == sorted(
        [JobStatus.done, JobStatus.pending, JobStatus.pending]
    )


async def test_a_second_signal_requeues_in_flight_jobs_without_spending_an_attempt(
    session_factory, session: AsyncSession
) -> None:
    [job_id] = await _enqueue(session_factory, 1)
    started = asyncio.Event()
    stop, abort = asyncio.Event(), asyncio.Event()

    async def stuck(payload, context) -> None:
        started.set()
        await asyncio.Event().wait()

    worker = asyncio.create_task(
        run_worker(
            jobs.JobContext(factory=session_factory),
            concurrency=2,
            poll_seconds=0.05,
            stop=stop,
            abort=abort,
            handlers={"test": stuck},
        )
    )
    await asyncio.wait_for(started.wait(), timeout=5)
    stop.set()
    abort.set()
    await asyncio.wait_for(worker, timeout=5)

    session.expire_all()
    job = await session.get(Job, job_id)
    assert job is not None
    assert job.status is JobStatus.pending
    assert job.locked_at is None
    assert job.attempts == 0
    # And it is immediately claimable by the next worker.
    [claimed] = await jobs.claim(session_factory)
    assert claimed.id == job_id
