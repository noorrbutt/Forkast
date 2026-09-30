"""Registration, login, refresh and logout.

The account and token logic lives in services/auth.py; see its docstring for
how sessions and refresh-token rotation work. What stays here is what needs
the request: the rate limits, the password-breach check, verifying a Google
ID token, and building the links that go out by email.

Every route here is unauthenticated, which makes them the only ones an attacker
can hammer for free, so they are the ones that are rate limited.
"""

from __future__ import annotations

import hashlib
import logging
import random
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from starlette.concurrency import run_in_threadpool

from app.api.deps import CurrentUser, RateLimiterDep, SessionDep, bearer_scheme
from app.config import get_settings
from app.models import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    GoogleAuthRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    SessionOut,
    TokenPair,
    VerifyEmailRequest,
)
from app.services import auth as auth_service
from app.services.email import send_password_reset_email, send_verification_email
from app.services.google import GoogleAuthError, verify_google_id_token
from app.services.password_check import is_password_breached
from app.services.rate_limit import account_identity, client_identity
from app.services.security import decode_access_token

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


async def _reject_breached_password(password: str) -> None:
    """Refuse a new password HIBP knows; the check itself fails open."""
    if await run_in_threadpool(is_password_breached, password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password has appeared in a data breach — please choose another.",
        )


async def _throttle_token_route(limiter: RateLimiterDep, request: Request, route: str) -> None:
    """Cap unauthenticated one-time-token routes per peer.

    The tokens themselves are unguessable; this bounds request volume, and on
    reset-password the outbound HIBP call each request makes.
    """
    settings = get_settings()
    await limiter.hit(
        route,
        client_identity(request),
        limit=settings.login_peer_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )


async def _throttle_email_route(
    limiter: RateLimiterDep, request: Request, route: str, email: str
) -> None:
    """Cap a route that mails an address, per address and per peer.

    The address is hashed rather than stored in the counter table, which only
    ever needs to tell two addresses apart.
    """
    settings = get_settings()
    await limiter.hit(
        f"{route}-account",
        f"email:{hashlib.sha256(email.encode('utf-8')).hexdigest()}",
        limit=settings.login_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )
    await limiter.hit(
        f"{route}-peer",
        client_identity(request),
        limit=settings.login_peer_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )


async def _throttle_sessions(limiter: RateLimiterDep, user: User) -> None:
    """One per-account bucket shared by the session list and revoke routes."""
    settings = get_settings()
    await limiter.hit(
        "sessions",
        account_identity(user.id),
        limit=settings.refresh_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )


async def _prune_if_due(limiter: RateLimiterDep) -> None:
    """Run both stale-data cleanups rarely enough to avoid churn on hot paths."""
    if random.randint(1, 50) != 1:  # noqa: S311 - non-crypto sampling for cleanup throttling
        return
    await limiter.prune_all()


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


def _caller_session_id(credentials: HTTPAuthorizationCredentials | None) -> uuid.UUID | None:
    claims = decode_access_token(credentials.credentials) if credentials is not None else None
    return claims.session_id if claims is not None else None


def _deep_link(path: str, **params: str) -> str:
    """An https App Link when the domain is configured, the bare custom
    scheme otherwise.

    Android lets any installed app claim a custom scheme, and most mail
    clients don't even linkify one, so forkast://... alone is both
    interceptable and often not clickable at all. An https link on a domain
    verified against the two /.well-known files in app/web.py has neither
    problem: the OS opens the app directly for a link on that domain, and
    the same URL still works as an ordinary web link for anyone else, since
    app/web.py serves a page there that hands off to the custom scheme
    itself. Falling back to the bare scheme when no domain is configured
    keeps local development, which has no public domain to verify, working
    exactly as it always did.
    """
    settings = get_settings()
    query = "&".join(f"{key}={quote(value, safe='')}" for key, value in params.items())
    if settings.app_domain:
        return f"https://{settings.app_domain}/{path}?{query}"
    return f"forkast://{path}?{query}"


async def _send_verification_email_safely(user: User, raw_token: str) -> None:
    link = _deep_link("check-email", token=raw_token, email=user.email)
    try:
        await run_in_threadpool(send_verification_email, user.email, link)
    except Exception:
        logger.exception("Verification email delivery failed for user_id=%s", user.id)


async def _send_password_reset_email_safely(user: User, raw_token: str) -> None:
    link = _deep_link("reset-password", token=raw_token)
    try:
        await run_in_threadpool(send_password_reset_email, user.email, link)
    except Exception:
        logger.exception("Password reset email delivery failed for user_id=%s", user.id)


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    email = payload.email.strip()
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
    await auth_service.ensure_email_free(session, email)
    await _reject_breached_password(payload.password)

    user, verification_token, tokens = await auth_service.register_user(
        session,
        email=email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
    )
    await _send_verification_email_safely(user, verification_token)
    return tokens


@router.post("/verify-email")
async def verify_email(
    payload: VerifyEmailRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> dict[str, str]:
    await _throttle_token_route(limiter, request, "verify-email")
    await auth_service.verify_email(session, payload.token)
    return {"detail": "Email verified."}


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
async def resend_verification(
    background_tasks: BackgroundTasks,
    payload: ResendVerificationRequest,
    session: SessionDep,
    request: Request,
    limiter: RateLimiterDep,
) -> Response:
    email = str(payload.email).strip().lower()
    await _throttle_email_route(limiter, request, "resend-verification", email)

    issued = await auth_service.start_email_verification(session, email)
    if issued is not None:
        # After the response, so an unverified account answers as fast as an
        # unknown address and the delay does not reveal which one this is.
        background_tasks.add_task(_send_verification_email_safely, *issued)

    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    session: SessionDep,
    user: CurrentUser,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    limiter: RateLimiterDep,
) -> list[SessionOut]:
    await _throttle_sessions(limiter, user)
    return await auth_service.list_sessions(session, user, _caller_session_id(credentials))


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    limiter: RateLimiterDep,
) -> Response:
    await _throttle_sessions(limiter, user)
    await auth_service.revoke_session(session, user, session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/revoke-others", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_other_sessions(
    session: SessionDep,
    user: CurrentUser,
    limiter: RateLimiterDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Response:
    await _throttle_sessions(limiter, user)
    current = _caller_session_id(credentials)
    if current is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    await auth_service.revoke_other_sessions(session, user, keep=current)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    background_tasks: BackgroundTasks,
    payload: ForgotPasswordRequest,
    session: SessionDep,
    request: Request,
    limiter: RateLimiterDep,
) -> Response:
    email = str(payload.email).strip().lower()
    await _throttle_email_route(limiter, request, "forgot-password", email)

    issued = await auth_service.start_password_reset(session, email)
    if issued is not None:
        # After the response, for the same enumeration reason as resend.
        background_tasks.add_task(_send_password_reset_email_safely, *issued)

    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> dict[str, str]:
    await _throttle_token_route(limiter, request, "reset-password")
    # Before the token is consumed, so a refused password leaves the link usable.
    await _reject_breached_password(payload.new_password)
    await auth_service.reset_password(session, payload.token, payload.new_password)
    return {"detail": "Password reset."}


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    await _throttle_login(limiter, request, payload.email)
    await _prune_if_due(limiter)

    user = await auth_service.authenticate(session, payload.email, payload.password)
    return await auth_service.issue_tokens(session, user)


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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    tokens, created = await auth_service.sign_in_with_google(session, identity)
    # 201 when this call made the account, 200 when it found one. Register
    # already answers 201 and the client reads both the same way, which is what
    # decides whether the one time setup questions are asked. Set on the
    # response rather than declared on the route, because the route genuinely
    # does both and only finds out which partway through.
    if created:
        response.status_code = status.HTTP_201_CREATED
    return tokens


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    payload: RefreshRequest, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    # Keyed on the peer alone: the refresh token is the subject here and it must
    # not become a rate-limit identity, or an attacker gets a fresh allowance
    # for every random string they try.
    await limiter.hit(
        "refresh",
        client_identity(request),
        limit=get_settings().refresh_rate_limit,
        window_seconds=get_settings().login_rate_window_seconds,
    )
    await _prune_if_due(limiter)
    return await auth_service.rotate_refresh_token(session, payload.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: SessionDep) -> Response:
    await auth_service.log_out(session, payload.refresh_token)
    # Always 204. Logging out an already dead token is not an error worth
    # telling the caller about, and answering differently would say whether the
    # token was real.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
