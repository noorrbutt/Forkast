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
import random
import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import RateLimiterDep, SessionDep
from app.config import get_settings
from app.models import RefreshToken, User
from app.schemas.auth import (
    GoogleAuthRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from app.services.google import GoogleAuthError, GoogleIdentity, verify_google_id_token
from app.services.rate_limit import client_identity, prune_refresh_tokens
from app.services.security import (
    create_access_token,
    create_refresh_token,
    hash_password_async,
    hash_refresh_token,
    verify_password_async,
    waste_time_like_a_verify,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _prune_if_due(limiter: RateLimiterDep) -> None:
    """Run both stale-data cleanups rarely enough to avoid churn on hot paths."""
    if random.randint(1, 50) != 1:
        return
    await limiter.prune()
    await prune_refresh_tokens(limiter._session_factory)


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

    user = User(
        email=email,
        password_hash=await hash_password_async(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
    )
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
    await _prune_if_due(limiter)

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

    # A Google-only account has no password to compare against, and passing None
    # to the verifier raises rather than returning False. It still burns the
    # same time as a real check and still answers with the same words: replying
    # "this account signs in with Google" would say that the address exists,
    # which is the thing the shared message is there to hide.
    if user.password_hash is None:
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


async def _user_for_google_identity(
    session: SessionDep, identity: GoogleIdentity
) -> tuple[User, bool]:
    """Find, link, or create the account this Google identity names.

    Returns the account and whether it had to be created, because the client
    needs to tell those apart: a brand new account gets the one time setup
    questions and an existing one must never be sent back through them.

    Three cases, in the order they are tried.

    Known `sub`: this Google account has signed in here before, so it is that
    account, whatever address the token carries now. Keying on `sub` rather than
    the address is what makes a Google user who changes their Gmail address keep
    their meals instead of quietly starting a second account.

    Known address, no `sub` yet: somebody who registered with a password is now
    pressing "Continue with Google" with the same address. That is the same
    person, and the alternative -- a second account on the same address -- is
    refused by the unique index anyway, so the sign in would simply fail
    forever. The identity is attached to the existing row and both doors now
    open it. This is only safe because verify_google_id_token refuses a token
    whose email Google has not verified; without that check this branch would
    hand somebody else's account to whoever could put their address in a Google
    profile.

    Neither: a new account, with no password. This is the only way a row with a
    null password_hash is ever created.
    """
    by_sub = await session.scalar(select(User).where(User.google_sub == identity.subject))
    if by_sub is not None:
        # Names are filled in if the account never had them, and left alone if
        # it did. Google is not the authority on what somebody is called here:
        # overwriting on every sign in would undo a name the user set in
        # Forkast every time they signed in.
        if by_sub.first_name is None and identity.first_name:
            by_sub.first_name = identity.first_name
        if by_sub.last_name is None and identity.last_name:
            by_sub.last_name = identity.last_name
        return by_sub, False

    by_email = await session.scalar(
        select(User).where(func.lower(User.email) == identity.email.lower())
    )
    if by_email is not None:
        by_email.google_sub = identity.subject
        if by_email.first_name is None and identity.first_name:
            by_email.first_name = identity.first_name
        if by_email.last_name is None and identity.last_name:
            by_email.last_name = identity.last_name
        # Not created: this is an account that already existed and has now
        # gained a second way in, so it has already been through setup.
        return by_email, False

    user = User(
        email=identity.email,
        # No password, and none invented. ck_users_has_a_way_in is satisfied by
        # the google_sub on the next line.
        password_hash=None,
        google_sub=identity.subject,
        first_name=identity.first_name,
        last_name=identity.last_name,
    )
    session.add(user)
    return user, True


@router.post("/google", response_model=TokenPair)
async def google(
    payload: GoogleAuthRequest,
    session: SessionDep,
    request: Request,
    limiter: RateLimiterDep,
    response: Response,
) -> TokenPair:
    """Sign in, or sign up, with a Google ID token the client already holds.

    One route rather than a pair, because the client genuinely cannot know which
    it is doing: the phone has a token from Google and no way to tell whether
    this person has a Forkast account. That is also why the button says
    "Continue with Google" on both screens rather than "Sign up" on one and
    "Sign in" on the other.
    """
    settings = get_settings()
    if not settings.google_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign in is not set up on this server.",
        )

    # Per peer, and sharing neither the login nor the register bucket. The token
    # is the subject here and must never become a rate-limit identity, for the
    # same reason the refresh route keys on the peer alone: an attacker would
    # get a fresh allowance for every random string they tried.
    await limiter.hit(
        "google",
        client_identity(request),
        limit=settings.login_peer_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )

    try:
        identity = await verify_google_id_token(payload.id_token)
    except GoogleAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    user, created = await _user_for_google_identity(session, identity)

    try:
        await session.flush()
    except IntegrityError as exc:
        # Two first sign ins for the same brand new Google account arriving at
        # once both miss the lookups above and both insert; the unique index on
        # google_sub catches the loser. Same shape as the race register already
        # guards, and the honest answer is "try again" rather than a 500.
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That Google account was being set up already. Try again.",
        ) from exc

    # 201 when this call made the account, 200 when it found one. Register
    # already answers 201 and the client reads both the same way, which is what
    # decides whether the one time setup questions are asked. Set on the
    # response rather than declared on the route, because the route genuinely
    # does both and only finds out which partway through.
    if created:
        response.status_code = status.HTTP_201_CREATED

    return await _issue_tokens(session, user)


async def _revoke_family_on_reuse(
    session: SessionDep, session_id: uuid.UUID, now: dt.datetime
) -> None:
    """Kill every live refresh token in the session that just got replayed.

    A replayed refresh token is evidence of a leak; it means the holder of the
    token is still trying to use it after the valid client already rotated it.
    The response stays silent, but the session is what gets torn down rather
    than every live session for that user. A fresh retry within the grace period
    is treated as a client-side timeout, not a leak.
    """
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.session_id == session_id,
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
    await _prune_if_due(limiter)

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
        # already been spent. A retry within the grace period is a client-side
        # timeout, not a leak, so the same session gets a fresh pair rather
        # than every live token for the account getting logged out.
        reused = await session.scalar(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at.is_not(None),
            )
        )
        if reused is not None:
            leeway = dt.timedelta(seconds=get_settings().refresh_reuse_leeway_seconds)
            if reused.revoked_at is not None and now - reused.revoked_at <= leeway:
                live_in_session = await session.scalar(
                    select(RefreshToken).where(
                        RefreshToken.session_id == reused.session_id,
                        RefreshToken.revoked_at.is_(None),
                        RefreshToken.expires_at > now,
                    )
                )
                if live_in_session is not None:
                    user = await session.get(User, reused.user_id)
                    if user is not None:
                        return await _issue_tokens(session, user, session_id=reused.session_id)

            await _revoke_family_on_reuse(session, reused.session_id, now)
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
