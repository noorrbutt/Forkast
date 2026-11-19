"""Helpers for private, conditional responses."""

import hashlib


def content_etag(content: bytes) -> str:
    """Return a strong ETag for the exact response representation."""
    return f'"{hashlib.sha256(content).hexdigest()}"'


def if_none_match_matches(header: str | None, etag: str) -> bool:
    """Apply GET's weak comparison semantics to an If-None-Match header."""
    if header is None:
        return False
    return any(
        candidate.strip() == "*" or candidate.strip().removeprefix("W/") == etag
        for candidate in header.split(",")
    )
