from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import logging

from sqlalchemy import select

from app.api.v1.logs import _refine_estimate
from app.db import get_session_factory
from app.models import FoodLog
from app.services.ai.deps import get_ai_service
from app.services.rate_limit import RateLimiter, prune_refresh_tokens

logger = logging.getLogger(__name__)


async def _prune_all() -> tuple[int, int]:
    session_factory = get_session_factory()
    limiter = RateLimiter(session_factory)
    rate_limit_rows = await limiter.prune()
    refresh_rows = await prune_refresh_tokens(session_factory)
    return rate_limit_rows, refresh_rows


async def _refine_backfill(limit: int = 100) -> int:
    session_factory = get_session_factory()
    ai = get_ai_service()
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=10)
    async with session_factory() as session:
        rows = await session.execute(
            select(FoodLog.id, FoodLog.category_id)
            .where(FoodLog.estimate_refined_at.is_(None), FoodLog.created_at < cutoff)
            .limit(limit)
        )
        rows_list = rows.all()

    for log_id, category_id in rows_list:
        await _refine_estimate(log_id, category_id, ai, session_factory)
    return len(rows_list)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run background maintenance tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("prune", help="Delete stale rate-limit counters and expired refresh tokens.")
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
