"""Registration, login, refresh and logout.

Access tokens are short lived JWTs. Refresh tokens are opaque, stored as a
SHA-256 hash, and rotated on every use: presenting a refresh token revokes it
and issues a new one. That way a stolen refresh token stops working as soon as
the legitimate client refreshes.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

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
    hash_password_async,
    hash_refresh_token,
    verify_password_async,
    waste_time_like_a_verify,
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

    user = User(email=email, password_hash=await hash_password_async(payload.password))
    session.add(user)

    try:
        await session.flush()
    except IntegrityError as exc:
        # The check above is not atomic. Two simultaneous registrations for the
        # same address both pass it and the unique index on lower(email) catches
        # the loser, which should still read as a conflict rather than a 500.
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists",
        ) from exc

    return await _issue_tokens(session, user)


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, session: SessionDep) -> TokenPair:
    user = await session.scalar(
        select(User).where(func.lower(User.email) == payload.email.strip().lower())
    )
    # Same message whether the email is unknown or the password is wrong. The
    # matching hash below is just as important: replying quickly for an unknown
    # address and slowly for a known one leaks exactly what the shared message
    # is trying to hide.
    if user is None:
        await waste_time_like_a_verify()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not await verify_password_async(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    return await _issue_tokens(session, user)


async def _revoke_family_on_reuse(
    session: SessionDep, token_hash: str, now: dt.datetime
) -> None:
    """Kill every live token for the owner of an already-spent refresh token.

    Silent by design: the caller still gets the same "invalid or expired"
    message it would have got for a token that never existed, because telling
    an attacker which of the two happened is telling them their token was real.
    An expired-but-unrevoked token is left alone -- that is an idle client, not
    evidence of a leak.
    """
    reused = await session.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_not(None),
        )
    )
    if reused is None:
        return

    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == reused.user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await session.commit()


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    token_hash = hash_refresh_token(payload.refresh_token)
    now = dt.datetime.now(dt.UTC)

    # Claim the token in a single conditional UPDATE rather than reading it,
    # checking it, then writing it back. Two requests arriving together with the
    # same token would both pass a read-then-check and both be issued a new pair,
    # which quietly defeats the point of rotation. Here exactly one wins, because
    # only one UPDATE can match a row that is still unrevoked.
    claimed = await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
        .values(revoked_at=now)
        .returning(RefreshToken.user_id)
    )
    row = claimed.first()
    if row is None:
        # Nothing matched. Either the token never existed, or it did and has
        # already been spent -- and the second case is the interesting one.
        # Rotation alone does not help if the thief refreshes first: the victim
        # gets a 401 and the thief holds a chain that keeps rotating forever.
        # A replay of an already-revoked token is the signal that the chain
        # leaked, so every live token for that account goes with it and both
        # sides have to log in again. RFC 9700 section 4.14.2.
        await _revoke_family_on_reuse(session, token_hash, now)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user = await session.get(User, row[0])
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

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
