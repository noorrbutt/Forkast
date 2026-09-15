"""Password hashing and JWT issuing/verification.

pwdlib[argon2] + PyJWT, following FastAPI's current security tutorial. Not
passlib (last release 2020-10-08) and not python-jose, which has not shipped
since 2025-05 and pulls in `ecdsa`, carrying the unpatched CVE-2024-23342
Minerva timing attack.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid
from typing import Any, Literal

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash

from app.config import get_settings

_password_hash = PasswordHash.recommended()  # Argon2

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def create_access_token(user_id: uuid.UUID) -> tuple[str, dt.datetime]:
    settings = get_settings()
    expires_at = _now() + dt.timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "type": "access",
        "iat": int(_now().timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": secrets.token_urlsafe(8),
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_at


def create_refresh_token() -> tuple[str, str, dt.datetime]:
    """Return (raw_token, sha256_hash, expires_at).

    The refresh token is opaque rather than a JWT: it must be revocable, and
    revocation needs a database row regardless. Only the hash is ever stored,
    so a database leak does not hand out usable sessions.
    """
    settings = get_settings()
    raw = secrets.token_urlsafe(48)
    expires_at = _now() + dt.timedelta(days=settings.refresh_token_expire_days)
    return raw, hash_refresh_token(raw), expires_at


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def decode_access_token(token: str) -> uuid.UUID | None:
    """Return the user id, or None if the token is invalid, expired or the
    wrong type. Never raises -- callers turn None into a 401."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except InvalidTokenError:
        return None

    if payload.get("type") != "access":
        return None
    subject = payload.get("sub")
    if not subject:
        return None
    try:
        return uuid.UUID(subject)
    except ValueError:
        return None
