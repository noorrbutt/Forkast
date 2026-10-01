from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import logging

from sqlalchemy import String, cast, exists, select

from app.db import get_session_factory
from app.models import FoodLog, Job
from app.models.enums import JobStatus
from app.services import jobs
from app.services.ai.deps import get_ai_service
from app.services.rate_limit import RateLimiter

logger = logging.getLogger(__name__)


async def _prune_all() -> tuple[int, int]:
    return await RateLimiter(get_session_factory()).prune_all()


# Refinement calls the AI provider, so unbounded concurrency here is
# unbounded concurrent calls against Groq (or whatever quota/rate limit it
# enforces) the moment a backlog builds up, e.g. after the process was down
# for a while. Bounded rather than sequential, since one-at-a-time makes a
# large backlog take as long as `limit` round trips in series for no reason.
_REFINE_BACKFILL_CONCURRENCY = 5


async def _refine_backfill(limit: int = 100) -> int:
    """Queue a refinement for every stale unrefined log, and run them now.

    Through the jobs queue, the same way a save triggers refinement: a log is
    picked up here only when no refinement job for it is pending or running,
    which leaves out anything a worker is already retrying. What that leaves
    is a log whose job was dead-lettered, one saved while the Groq circuit
    breaker was open (nothing is queued then), and one older than the queue.
    The jobs are committed before any is run, so an interrupted backfill
    leaves them for `python -m app.worker` rather than losing them.
    """
    session_factory = get_session_factory()
    context = jobs.JobContext(factory=session_factory, ai=get_ai_service())
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=10)
    queued = exists().where(
        Job.kind == jobs.REFINE_CALORIE_ESTIMATE,
        Job.status.in_([JobStatus.pending, JobStatus.running]),
        Job.payload["log_id"].astext == cast(FoodLog.id, String),
    )
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(FoodLog.id, FoodLog.category_id)
                .where(
                    FoodLog.estimate_refined_at.is_(None),
                    FoodLog.created_at < cutoff,
                    ~queued,
                )
                .limit(limit)
            )
        ).all()
        job_ids = [
            jobs.enqueue(
                session,
                jobs.REFINE_CALORIE_ESTIMATE,
                {"log_id": str(log_id), "category_id": category_id},
            ).id
            for log_id, category_id in rows
        ]
        await session.commit()

    semaphore = asyncio.Semaphore(_REFINE_BACKFILL_CONCURRENCY)

    async def _run_one(job_id) -> None:
        async with semaphore:
            await jobs.run_now(job_id, context)

    await asyncio.gather(*(_run_one(job_id) for job_id in job_ids))
    return len(job_ids)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run background maintenance tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "prune", help="Delete stale rate-limit counters and expired refresh tokens."
    )
    refine_parser = subparsers.add_parser(
        "refine-backfill", help="Retry stale log estimates whose refinement never landed."
    )
    refine_parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    if args.command == "prune":
        rate_limit_rows, refresh_rows = asyncio.run(_prune_all())
        logger.info("rate_limit=%s refresh_tokens=%s", rate_limit_rows, refresh_rows)
        return

    if args.command == "refine-backfill":
        refined = asyncio.run(_refine_backfill(args.limit))
        logger.info("refine_backfilled=%s", refined)
        return

    parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
