"""Vercel entrypoint: exposes the FastAPI app for Vercel's Python runtime.

At the project root (backend/ itself, once Root Directory is set to
backend/ -- see docs/VERCEL_DEPLOY.md), not under api/. Vercel auto-detects
an entrypoint named index.py (among a few other recognised names) at the
root and routes every request to it with the original path intact --
`/`, `/health`, `/api/v1/...`, all of it. A file under api/ only ever
handles `/api/*`, which is why this used to live at api/index.py paired
with a vercel.json rewrite: the rewrite's destination is used as the
literal request path by Vercel's router now rather than preserving the
original URL, so that pairing made every request look like a request for
"/api/index" from inside the app and 404'd on everything. This file needs
no rewrite at all.
"""

from __future__ import annotations

import sys
from pathlib import Path

# backend/ itself, so `app` resolves as a package whatever the working
# directory the runtime imports this file from.
_BACKEND_DIR = str(Path(__file__).resolve().parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from app.main import app  # noqa: E402

__all__ = ["app"]
