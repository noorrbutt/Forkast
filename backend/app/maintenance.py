from __future__ import annotations

import argparse
import asyncio

from app.db import get_session_factory
from app.services.rate_limit import RateLimiter, prune_refresh_tokens


async def _prune_all() -> tuple[int, int]:
    session_factory = get_session_factory()
    limiter = RateLimiter(session_factory)
    rate_limit_rows = await limiter.prune()
    refresh_rows = await prune_refresh_tokens(session_factory)
    return rate_limit_rows, refresh_rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Run background maintenance tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("prune", help="Delete stale rate-limit counters and expired refresh tokens.")
    args = parser.parse_args()

    if args.command == "prune":
        rate_limit_rows, refresh_rows = asyncio.run(_prune_all())
        print(f"rate_limit={rate_limit_rows} refresh_tokens={refresh_rows}")
        return

    parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
