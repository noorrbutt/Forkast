"""Read and write the dashboard/streak snapshot.

The dashboard and streak endpoints are placeholders in this scaffold. Rather
than inventing numbers that would visibly contradict the seeded history, the
seed script computes them once and writes them here, and the endpoints serve
that file.

The tradeoff is deliberate and was chosen explicitly: these figures match the
seeded logs and will drift the moment a new log is added. Every response
carries a `_source` marker so the staleness is visible rather than silent.
Replacing this with real SQL later is contained to the two route handlers.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SNAPSHOT_PATH = Path(__file__).resolve().parent / "snapshot.json"


def write_snapshot(payload: dict[str, Any]) -> None:
    SNAPSHOT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8"
    )


def read_snapshot() -> dict[str, Any] | None:
    """Return the snapshot, or None if the seed has never been run."""
    if not SNAPSHOT_PATH.exists():
        return None
    try:
        return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
