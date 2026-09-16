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
from typing import Any, Literal, NamedTuple

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from starlette.concurrency import run_in_threadpool

from app.config import get_settings

_password_hash = PasswordHash.recommended()  # Argon2

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    """Synchronous hash. Use hash_password_async from a request handler."""
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)


# Argon2 is deliberately slow, around 100ms. Called directly from an async
# handler it blocks the whole event loop for that time, so every other in flight
# request stalls behind one login. These wrappers push it onto a worker thread.
async def hash_password_async(password: str) -> str:
    return await run_in_threadpool(hash_password, password)


async def verify_password_async(password: str, password_hash: str) -> bool:
    return await run_in_threadpool(verify_password, password, password_hash)


# A real Argon2 hash of a value nobody can present, used to burn the same amount
# of time when the email is unknown. Without it, a fast rejection means "no such
# account" and a slow one means "wrong password", which is a working user
# enumeration oracle no matter how careful the error message is.
_DUMMY_HASH = hash_password("forkast-timing-equaliser")


async def waste_time_like_a_verify() -> None:
    await verify_password_async("not-the-password", _DUMMY_HASH)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, dt.datetime]:
    """Issue an access token bound to a session.

    The `sid` claim is what makes logout actually log out. Without it an access
    token is a bearer credential nothing can withdraw, so signing out revoked
    the refresh token and left the access token working until it expired --
    up to ACCESS_TOKEN_EXPIRE_MINUTES of access after the user asked for it to
    stop. Verifying `sid` against the session on each request costs nothing
    extra, because the request already loads the user row.
    """
    settings = get_settings()
    expires_at = _now() + dt.timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "sid": str(session_id),
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


class AccessClaims(NamedTuple):
    user_id: uuid.UUID
    session_id: uuid.UUID


def decode_access_token(token: str) -> AccessClaims | None:
    """Return the user and session ids, or None if the token is unusable.

    Never raises -- callers turn None into a 401. A token with no `sid` is
    rejected rather than waved through: those were issued before sessions
    existed, and accepting them would leave exactly the hole `sid` closes.
    """
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
    session = payload.get("sid")
    if not subject or not session:
        return None
    try:
        return AccessClaims(uuid.UUID(subject), uuid.UUID(session))
    except ValueError:
        return None
