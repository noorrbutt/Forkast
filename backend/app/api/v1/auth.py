"""Registration, login, refresh and logout.

Access tokens are short lived JWTs carrying a `sid` claim. Refresh tokens are
opaque, stored as a SHA-256 hash, and rotated on every use: presenting one
revokes it and issues a new one carrying the same session_id. A stolen refresh
token therefore stops working as soon as the legitimate client refreshes, and
signing out ends the access token at the same moment rather than leaving it
usable until it expires.

Every route here is unauthenticated, which makes them the only ones an attacker
can hammer for free, so they are the ones that are rate limited.
"""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import RateLimiterDep, SessionDep
from app.config import get_settings
from app.models import RefreshToken, User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from app.services.rate_limit import client_identity
from app.services.security import (
    create_access_token,
    create_refresh_token,
    hash_password_async,
    hash_refresh_token,
    verify_password_async,
    waste_time_like_a_verify,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _throttle_login(limiter: RateLimiterDep, request: Request, email: str) -> None:
    """Count one login attempt, against two separate allowances.

    Keyed on the address alone, one attacker locks out every account whose
    address they know. Keyed on the peer alone, a botnet spreads guesses and
    never trips anything. Keyed on both together -- which is the per-address
    bucket here -- a spray that tries one password against a thousand different
    accounts still spends nothing, because each account is only touched once.
    So both are counted: a tight limit per address, and a loose one per peer
    that only a spray can reach.

    Called before the password is checked, so a wrong guess and a right one cost
    the same and the limit cannot be probed by watching which attempts counted.
    """
    settings = get_settings()
    await limiter.hit(
        "login",
        client_identity(request, subject=email),
        limit=settings.login_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )
    await limiter.hit(
        "login-peer",
        client_identity(request),
        limit=settings.login_peer_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )


async def _issue_tokens(
    session: SessionDep, user: User, *, session_id: uuid.UUID | None = None
) -> TokenPair:
    """Issue a pair. Pass session_id to continue an existing session on refresh,
    or leave it out to start a new one on register and login."""
    session_id = session_id or uuid.uuid4()
    access_token, _ = create_access_token(user.id, session_id)
    raw_refresh, refresh_hash, refresh_expires = create_refresh_token()

    session.add(
        RefreshToken(
            user_id=user.id,
            session_id=session_id,
            token_hash=refresh_hash,
            expires_at=refresh_expires,
        )
    )
    # Commit here rather than in the session dependency: a yield dependency's
    # exit code runs after the response is sent, so the client could present
    # these tokens before the rows were durable and get a 401.
    await session.commit()

    return TokenPair(access_token=access_token, refresh_token=raw_refresh)


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    email = payload.email.strip()
    # Registration answers 409 for an address that already exists, which is a
    # working account existence oracle. Removing it entirely needs an email
    # round trip this project has no infrastructure for, so the limit is what
    # stops it being run against a list.
    #
    # Counted per peer, NOT per address: enumeration walks a list and uses a
    # different address every time, so keying on the address would give every
    # probe its own fresh allowance and never trip.
    settings = get_settings()
    await limiter.hit(
        "register",
        client_identity(request),
        limit=settings.register_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )

    existing = await session.scalar(select(User).where(func.lower(User.email) == email.lower()))
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
async def login(
    payload: LoginRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    await _throttle_login(limiter, request, payload.email)
    # Cheap to do here and there is no cron to install: the table only grows
    # while someone is failing to authenticate.
    await limiter.prune()

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


async def _revoke_family_on_reuse(session: SessionDep, token_hash: str, now: dt.datetime) -> None:
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
async def refresh(
    payload: RefreshRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    token_hash = hash_refresh_token(payload.refresh_token)
    now = dt.datetime.now(dt.UTC)

    # Keyed on the peer alone: the refresh token is the subject here and it must
    # not become a rate-limit identity, or an attacker gets a fresh allowance
    # for every random string they try.
    await limiter.hit(
        "refresh",
        client_identity(request),
        limit=get_settings().login_peer_rate_limit,
        window_seconds=get_settings().login_rate_window_seconds,
    )

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
        .returning(RefreshToken.user_id, RefreshToken.session_id)
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

    # The same session continues across the rotation, so the client is not
    # treated as having signed in again and access tokens keep naming one
    # session for the life of that sign-in.
    return await _issue_tokens(session, user, session_id=row[1])


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: SessionDep) -> Response:
    token_hash = hash_refresh_token(payload.refresh_token)
    stored = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

    if stored is not None:
        # Revoke the whole session, not just the row presented. Every refresh
        # token the session ever rotated through shares its session_id, and the
        # access token names it, so this is what makes the access token stop
        # working now rather than whenever it happens to expire.
        await session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.session_id == stored.session_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=dt.datetime.now(dt.UTC))
        )

    await session.commit()
    # Always 204. Logging out an already dead token is not an error worth
    # telling the caller about, and answering differently would say whether the
    # token was real.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
