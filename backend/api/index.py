"""Vercel entrypoint: exposes the FastAPI app for Vercel's Python runtime.

Vercel's Python runtime serves a top-level ASGI `app` from a file in /api.
vercel.json (beside this directory) rewrites every path here, so the routes
are exactly the ones `uvicorn app.main:app` serves. See docs/VERCEL_DEPLOY.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

# backend/ itself, so `app` resolves as a package whatever the working
# directory the runtime imports this file from.
_BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from app.main import app  # noqa: E402

__all__ = ["app"]
