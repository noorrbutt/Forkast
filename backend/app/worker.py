"""The jobs worker: `python -m app.worker [--concurrency N] [--poll SECONDS]`.

Claims due jobs from the jobs table and runs them, at most `concurrency` at a
time. Any number of these can run against the same database; SKIP LOCKED in
the claim keeps them off each other's rows (see services/jobs.py).

Requests already run the job they enqueue behind their own response, so on a
healthy server this mostly sees retries, backoffs coming due, and anything a
restart interrupted. It is what makes the queue durable rather than best effort.

Shutdown: the first SIGINT or SIGTERM stops claiming and lets in-flight jobs
finish. A second one stops waiting: the jobs still running are cancelled and
put straight back to pending, without spending an attempt, so whichever worker
comes up next picks them up. Nothing is ever left half-claimed until the
staleness sweep notices.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal
from collections.abc import Mapping

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.db import get_session_factory
from app.services import jobs
from app.services.ai.deps import get_ai_service

logger = logging.getLogger(__name__)


async def run_worker(
    context: jobs.JobContext,
    *,
    concurrency: int,
    poll_seconds: float,
    stop: asyncio.Event,
    abort: asyncio.Event | None = None,
    handlers: Mapping[str, jobs.Handler] | None = None,
) -> None:
    """Claim and run jobs until `stop` is set, then drain.

    The semaphore-like bound is simply never claiming more than the number of
    free slots, so a claimed job never sits waiting behind others while its
    claim ages towards the staleness cutoff.
    """
    abort = abort or asyncio.Event()
    in_flight: dict[asyncio.Task[jobs.JobStatus], jobs.ClaimedJob] = {}

    while not stop.is_set():
        free = concurrency - len(in_flight)
        claimed: list[jobs.ClaimedJob] = []
        if free > 0:
            try:
                claimed = await jobs.claim(context.factory, limit=free)
            except Exception:
                logger.warning("job_claim_failed", exc_info=True)
        for job in claimed:
            task = asyncio.create_task(jobs.run_claimed(job, context, handlers))
            in_flight[task] = job

        if claimed and len(in_flight) < concurrency:
            # There may be more due right now; go straight back for them.
            continue

        waiters: set[asyncio.Future] = {asyncio.ensure_future(stop.wait()), *in_flight}
        await asyncio.wait(
            waiters,
            timeout=poll_seconds if len(in_flight) < concurrency else None,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for waiter in waiters - set(in_flight):
            waiter.cancel()
        for task in [t for t in in_flight if t.done()]:
            in_flight.pop(task)

    if in_flight:
        logger.info("worker_draining jobs=%d", len(in_flight))
        abort_wait = asyncio.ensure_future(abort.wait())
        running = set(in_flight)
        while running and not abort.is_set():
            done, _ = await asyncio.wait(
                {abort_wait, *running}, return_when=asyncio.FIRST_COMPLETED
            )
            running -= done
        abort_wait.cancel()

        unfinished = {t: job for t, job in in_flight.items() if not t.done()}
        for task in unfinished:
            task.cancel()
        for task, job in unfinished.items():
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await jobs.release(context.factory, job)
            logger.info("job_released id=%s kind=%s", job.id, job.kind)


def _install_signal_handlers(stop: asyncio.Event, abort: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()

    def _on_signal() -> None:
        if stop.is_set():
            logger.warning("second shutdown signal: requeueing in-flight jobs")
            abort.set()
        else:
            logger.info("shutdown signal: finishing in-flight jobs, claiming no more")
            stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            # Windows' event loops have no add_signal_handler; a plain handler
            # runs on the main thread, so hand it back to the loop safely.
            signal.signal(sig, lambda *_: loop.call_soon_threadsafe(_on_signal))


async def _main(concurrency: int, poll_seconds: float) -> None:
    factory: async_sessionmaker[AsyncSession] = get_session_factory()
    context = jobs.JobContext(factory=factory, ai=get_ai_service())
    stop, abort = asyncio.Event(), asyncio.Event()
    _install_signal_handlers(stop, abort)
    logger.info("worker_started concurrency=%d poll=%ss", concurrency, poll_seconds)
    await run_worker(
        context, concurrency=concurrency, poll_seconds=poll_seconds, stop=stop, abort=abort
    )
    logger.info("worker_stopped")


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Run queued background jobs.")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=settings.worker_concurrency,
        help="How many jobs to run at once (WORKER_CONCURRENCY).",
    )
    parser.add_argument(
        "--poll",
        type=float,
        default=settings.worker_poll_seconds,
        help="Seconds to wait between claims when the queue is empty (WORKER_POLL_SECONDS).",
    )
    args = parser.parse_args()
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(_main(args.concurrency, args.poll))


if __name__ == "__main__":
    main()
