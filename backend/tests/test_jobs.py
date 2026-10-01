"""The jobs queue itself: retries, backoff, dead letters, and claiming.

These go through services/jobs.py directly rather than the API, since the
queue has no routes of its own and the interesting cases -- two workers racing
for one row, a worker dying mid-job -- cannot be produced from a request.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import random

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Job
from app.models.enums import JobStatus
from app.services import jobs


async def _enqueue(session_factory, kind: str = "test", **kwargs) -> Job:
    async with session_factory() as db:
        job = jobs.enqueue(db, kind, {"n": 1}, **kwargs)
        await db.commit()
    return job


async def _reload(session: AsyncSession, job_id) -> Job:
    session.expire_all()
    job = await session.get(Job, job_id)
    assert job is not None
    return job


async def _make_due(session: AsyncSession, job_id) -> None:
    """Skip the backoff wait rather than sleep through it."""
    await session.execute(
        update(Job).where(Job.id == job_id).values(run_at=dt.datetime.now(dt.UTC))
    )
    await session.commit()


async def test_a_job_that_fails_once_then_succeeds_ends_done(
    session_factory, session: AsyncSession
) -> None:
    """The failed run is counted, and the retry is what finishes it."""
    calls = 0

    async def flaky(payload, context) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("first try fails")

    handlers = {"test": flaky}
    context = jobs.JobContext(factory=session_factory)
    job = await _enqueue(session_factory)

    [claimed] = await jobs.claim(session_factory)
    assert await jobs.run_claimed(claimed, context, handlers) is JobStatus.pending
    failed = await _reload(session, job.id)
    assert failed.attempts == 1
    assert failed.last_error == "RuntimeError: first try fails"

    await _make_due(session, job.id)
    [retried] = await jobs.claim(session_factory)
    assert retried.attempts == 1
    assert await jobs.run_claimed(retried, context, handlers) is JobStatus.done

    done = await _reload(session, job.id)
    assert done.status is JobStatus.done
    assert done.attempts == 1
    assert done.locked_at is None
    assert calls == 2


async def test_a_failure_pushes_run_at_out_by_the_exponential_backoff(
    session_factory, session: AsyncSession
) -> None:
    """base * 2^attempts, plus up to half again as jitter.

    Asserted as a window rather than a value, since the jitter is the point.
    The window is measured against the database's clock either side of the
    failure, which is the clock run_at is written with.
    """
    settings = get_settings()
    job = await _enqueue(session_factory)

    for attempts in (1, 2, 3):
        [claimed] = await jobs.claim(session_factory)
        before = await session.scalar(select(func.clock_timestamp()))
        await session.commit()
        await jobs.fail(session_factory, claimed, "boom")
        after = await session.scalar(select(func.clock_timestamp()))
        await session.commit()

        reloaded = await _reload(session, job.id)
        assert reloaded.status is JobStatus.pending
        assert reloaded.attempts == attempts
        base = settings.job_backoff_base_seconds * 2**attempts
        delay_low = before + dt.timedelta(seconds=base) - dt.timedelta(seconds=1)
        delay_high = after + dt.timedelta(seconds=base * 1.5) + dt.timedelta(seconds=1)
        assert delay_low <= reloaded.run_at <= delay_high
        # Not due yet, so nothing can claim it before the wait is over.
        assert await jobs.claim(session_factory) == []
        await _make_due(session, job.id)


def test_backoff_grows_exponentially_with_bounded_jitter() -> None:
    settings = get_settings()
    rng = random.Random(1234)
    for attempts in range(1, 6):
        base = settings.job_backoff_base_seconds * 2**attempts
        samples = [jobs.backoff_seconds(attempts, rng=rng) for _ in range(50)]
        expected_high = min(base * 1.5, settings.job_backoff_max_seconds)
        assert all(
            min(base, settings.job_backoff_max_seconds) <= s <= expected_high for s in samples
        )
        # Jitter actually varies the delay, so a burst does not retry in step.
        assert len(set(samples)) > 1 or base >= settings.job_backoff_max_seconds


async def test_a_job_that_always_fails_is_dead_lettered_and_never_claimed_again(
    session_factory, session: AsyncSession
) -> None:
    async def broken(payload, context) -> None:
        raise RuntimeError("always")

    handlers = {"test": broken}
    context = jobs.JobContext(factory=session_factory)
    job = await _enqueue(session_factory, max_attempts=3)

    outcomes = []
    for _ in range(3):
        [claimed] = await jobs.claim(session_factory)
        outcomes.append(await jobs.run_claimed(claimed, context, handlers))
        await _make_due(session, job.id)

    assert outcomes == [JobStatus.pending, JobStatus.pending, JobStatus.dead_letter]
    dead = await _reload(session, job.id)
    assert dead.status is JobStatus.dead_letter
    assert dead.attempts == 3
    assert dead.last_error == "RuntimeError: always"

    # Due by run_at, and still never handed out again.
    assert await jobs.claim(session_factory, limit=10) == []


async def test_two_concurrent_claims_never_get_the_same_job(session_factory) -> None:
    """Each claim on its own connection, racing for a single row: one wins,
    the other gets nothing rather than a second copy."""
    job = await _enqueue(session_factory)

    for _ in range(5):
        results = await asyncio.gather(
            jobs.claim(session_factory, limit=1), jobs.claim(session_factory, limit=1)
        )
        claimed = [c for result in results for c in result]
        if claimed:
            break
    assert [c.id for c in claimed] == [job.id]


async def test_concurrent_claims_split_a_backlog_without_overlap(session_factory) -> None:
    enqueued = {(await _enqueue(session_factory)).id for _ in range(20)}

    results = await asyncio.gather(*(jobs.claim(session_factory, limit=3) for _ in range(10)))

    claimed = [c.id for result in results for c in result]
    assert len(claimed) == len(set(claimed)), "a job was handed to two claimers"
    assert set(claimed) == enqueued


async def test_a_claim_skips_a_row_another_transaction_has_locked(session_factory) -> None:
    """The SKIP LOCKED half, made deterministic: hold the row lock open in one
    transaction and claim from another while it is still held."""
    job = await _enqueue(session_factory)

    async with session_factory() as holder:
        await holder.execute(select(Job).where(Job.id == job.id).with_for_update())
        assert await jobs.claim(session_factory) == []
        await holder.rollback()

    [claimed] = await jobs.claim(session_factory)
    assert claimed.id == job.id


async def test_a_job_survives_its_worker_dying_mid_run(
    session_factory, session: AsyncSession
) -> None:
    """Claimed, then never finished, the way a killed process leaves it.

    It is not handed out again while the claim is fresh, since the worker may
    just be slow. Once the claim is older than job_stale_seconds, the next
    claim puts it back and takes it, and the lost run counts as an attempt.
    """
    job = await _enqueue(session_factory)
    [first] = await jobs.claim(session_factory)
    assert first.id == job.id
    # ...and the worker dies here.

    assert await jobs.claim(session_factory) == []

    stale = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=get_settings().job_stale_seconds + 5)
    await session.execute(update(Job).where(Job.id == job.id).values(locked_at=stale))
    await session.commit()

    [recovered] = await jobs.claim(session_factory)
    assert recovered.id == job.id
    assert recovered.attempts == 1

    # The dead worker coming back cannot overwrite the new claim's result.
    await jobs.complete(session_factory, first)
    assert (await _reload(session, job.id)).status is JobStatus.running

    await jobs.complete(session_factory, recovered)
    assert (await _reload(session, job.id)).status is JobStatus.done


async def test_a_job_that_keeps_killing_its_worker_is_eventually_dead_lettered(
    session_factory, session: AsyncSession
) -> None:
    job = await _enqueue(session_factory, max_attempts=2)
    stale = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=get_settings().job_stale_seconds + 5)

    for _ in range(2):
        await jobs.claim(session_factory)
        await session.execute(update(Job).where(Job.id == job.id).values(locked_at=stale))
        await session.commit()

    assert await jobs.claim(session_factory) == []
    assert (await _reload(session, job.id)).status is JobStatus.dead_letter


async def test_an_unknown_kind_is_retried_not_lost(session_factory, session: AsyncSession) -> None:
    job = await _enqueue(session_factory, kind="nobody-handles-this")
    [claimed] = await jobs.claim(session_factory)
    await jobs.run_claimed(claimed, jobs.JobContext(factory=session_factory), {})
    reloaded = await _reload(session, job.id)
    assert reloaded.status is JobStatus.pending
    assert "no handler" in (reloaded.last_error or "")
