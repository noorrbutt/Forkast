"""The demo seed script refuses to run against a real deployment.

DEMO_PASSWORD is a fixed string sitting in this repo, so running the script
with ENVIRONMENT=production would create a publicly known login into a real
database. This is checked without ever touching the database: the guard has
to reject the run before it opens a session at all.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass

import pytest

from app.config import Environment
from app.seed import run as seed_run


@dataclass
class _FakeSettings:
    environment: Environment


async def test_seed_refuses_to_run_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(seed_run, "get_settings", lambda: _FakeSettings(Environment.production))

    # Raised before `SessionLocal()` is ever opened, so this genuinely never
    # touches a database -- seed.run imports SessionLocal at module level
    # rather than through the test client's DI override, so anything past
    # the guard would run against whatever DATABASE_URL is configured
    # outside the suite, not the throwaway test database.
    with pytest.raises(SystemExit, match="production"):
        await seed_run.seed()


def test_reset_only_is_exempt_from_the_guard() -> None:
    """--reset deletes the demo row and creates no credential, so there is
    nothing here for the production guard to protect against. Checked at the
    source rather than by actually running the script, for the same
    real-database reason as above."""
    source = inspect.getsource(seed_run.seed)
    guard_line = next(line for line in source.splitlines() if "Environment.production" in line)
    assert "not reset_only" in guard_line
