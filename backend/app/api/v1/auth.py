"""Registration, login, refresh and logout.

Access tokens are short lived JWTs. Refresh tokens are opaque, stored as a
SHA-256 hash, and rotated on every use: presenting a refresh token revokes it
and issues a new one. That way a stolen refresh token stops working as soon as
the legitimate client refreshes.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, SessionDep
from app.models import RefreshToken, User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)
from app.services.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _issue_tokens(session: SessionDep, user: User) -> TokenPair:
    access_token, _ = create_access_token(user.id)
    raw_refresh, refresh_hash, refresh_expires = create_refresh_token()

    session.add(
        RefreshToken(user_id=user.id, token_hash=refresh_hash, expires_at=refresh_expires)
    )
    # Commit here rather than in the session dependency: a yield dependency's
    # exit code runs after the response is sent, so the client could present
    # these tokens before the rows were durable and get a 401.
    await session.commit()

    return TokenPair(access_token=access_token, refresh_token=raw_refresh)


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: SessionDep) -> TokenPair:
    email = payload.email.strip()

    existing = await session.scalar(
        select(User).where(func.lower(User.email) == email.lower())
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists",
        )

    user = User(email=email, password_hash=hash_password(payload.password))
    session.add(user)
    await session.flush()

    return await _issue_tokens(session, user)


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, session: SessionDep) -> TokenPair:
    user = await session.scalar(
        select(User).where(func.lower(User.email) == payload.email.strip().lower())
    )
    # Same message whether the email is unknown or the password is wrong, so the
    # endpoint cannot be used to enumerate registered addresses.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    return await _issue_tokens(session, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    token_hash = hash_refresh_token(payload.refresh_token)
    stored = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

    now = dt.datetime.now(dt.UTC)
    if stored is None or stored.revoked_at is not None or stored.expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user = await session.get(User, stored.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    # Rotation: the presented token dies here and a fresh pair is issued.
    stored.revoked_at = now
    return await _issue_tokens(session, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: SessionDep) -> Response:
    token_hash = hash_refresh_token(payload.refresh_token)
    stored = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if stored is not None and stored.revoked_at is None:
        stored.revoked_at = dt.datetime.now(dt.UTC)
    await session.commit()
    # Always 204. Logging out an already dead token is not an error worth
    # telling the caller about.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
