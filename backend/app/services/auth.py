"""Accounts, sessions and the one-time tokens that go with them.

What the auth routes do once a request has been let through: the rate limits,
the password-breach check and the Google signature check stay at the route,
where they can see the request, and everything here works on a database session
and plain values.

Access tokens are short lived JWTs carrying a `sid` claim. Refresh tokens are
opaque, stored as a SHA-256 hash, and rotated on every use: presenting one
revokes it and issues a new one carrying the same session_id. A stolen refresh
token therefore stops working as soon as the legitimate client refreshes, and
signing out ends the access token at the same moment rather than leaving it
usable until it expires.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import EmailVerificationToken, PasswordResetToken, RefreshToken, User
from app.schemas.auth import SessionOut, TokenPair
from app.services.google import GoogleIdentity
from app.services.jobs import SEND_EMAIL, enqueue
from app.services.security import (
    create_access_token,
    create_refresh_token,
    hash_password_async,
    hash_refresh_token,
    verify_password_async,
    waste_time_like_a_verify,
)

EMAIL_VERIFICATION_TTL = dt.timedelta(hours=24)
PASSWORD_RESET_TTL = dt.timedelta(minutes=45)

_EMAIL_TAKEN = "An account with that email already exists"
_BAD_LOGIN = "Incorrect email or password"
_BAD_REFRESH = "Invalid or expired refresh token"


async def user_by_email(session: AsyncSession, email: str) -> User | None:
    """Case-insensitively, matching the unique index on lower(email)."""
    return await session.scalar(select(User).where(func.lower(User.email) == email.lower()))


async def issue_tokens(
    session: AsyncSession, user: User, *, session_id: uuid.UUID | None = None
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


async def _issue_one_time_token(
    session: AsyncSession,
    user: User,
    model: type[EmailVerificationToken] | type[PasswordResetToken],
    ttl: dt.timedelta,
) -> str:
    """A fresh single-use link, and every earlier unused one for it spent.

    Only the newest link in the user's inbox works, so an old email that
    somebody else got hold of is worth nothing once a new one has been sent.
    """
    now = dt.datetime.now(dt.UTC)
    await session.execute(
        update(model).where(model.user_id == user.id, model.used_at.is_(None)).values(used_at=now)
    )
    raw_token = secrets.token_urlsafe(32)
    session.add(
        model(user_id=user.id, token_hash=hash_refresh_token(raw_token), expires_at=now + ttl)
    )
    await session.flush()
    return raw_token


def deep_link(path: str, **params: str) -> str:
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


def queue_verification_email(session: AsyncSession, user: User, raw_token: str) -> uuid.UUID:
    """Queue the link email on the caller's transaction, beside the token row.

    So the token and the email that carries it commit together: no email goes
    out for a token that rolled back, and no token commits without its email
    queued. The address is the one on the user right now, which for an email
    change is the new one.
    """
    link = deep_link("check-email", token=raw_token, email=user.email)
    return _queue_email(session, user, "verify_email", link)


def queue_password_reset_email(session: AsyncSession, user: User, raw_token: str) -> uuid.UUID:
    link = deep_link("reset-password", token=raw_token)
    return _queue_email(session, user, "reset_password", link)


def _queue_email(session: AsyncSession, user: User, template: str, link: str) -> uuid.UUID:
    job = enqueue(
        session,
        SEND_EMAIL,
        {"template": template, "to": user.email, "link": link, "user_id": str(user.id)},
    )
    return job.id


async def issue_email_verification_token(session: AsyncSession, user: User) -> str:
    return await _issue_one_time_token(
        session, user, EmailVerificationToken, EMAIL_VERIFICATION_TTL
    )


async def issue_password_reset_token(session: AsyncSession, user: User) -> str:
    return await _issue_one_time_token(session, user, PasswordResetToken, PASSWORD_RESET_TTL)


async def _consume_one_time_token(
    session: AsyncSession,
    model: type[EmailVerificationToken] | type[PasswordResetToken],
    raw_token: str,
    now: dt.datetime,
    invalid_detail: str,
) -> User:
    """Spend a link and return whose it was, in one conditional UPDATE.

    Claimed by the write itself rather than read and then marked, so two clicks
    on the same link cannot both succeed. Every other unused link for the same
    account is spent alongside it, since the job they were sent for is done.
    """
    user_id = await session.scalar(
        update(model)
        .where(
            model.token_hash == hash_refresh_token(raw_token),
            model.used_at.is_(None),
            model.expires_at > now,
        )
        .values(used_at=now)
        .returning(model.user_id)
    )
    user = await session.get(User, user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=invalid_detail)
    return user


async def _spend_remaining_tokens(
    session: AsyncSession,
    model: type[EmailVerificationToken] | type[PasswordResetToken],
    user: User,
    now: dt.datetime,
) -> None:
    await session.execute(
        update(model).where(model.user_id == user.id, model.used_at.is_(None)).values(used_at=now)
    )


async def ensure_email_free(session: AsyncSession, email: str) -> None:
    """Refuse an address that already has an account.

    That makes registration a working account existence oracle. Removing it
    entirely needs an email round trip this project has no infrastructure for,
    so the per-peer limit on the route is what stops it being run against a list.
    """
    if await user_by_email(session, email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_TAKEN)


async def register_user(
    session: AsyncSession, *, email: str, password: str, first_name: str, last_name: str
) -> tuple[User, uuid.UUID, TokenPair]:
    """Create a password account, and return it with the id of its queued
    verification email and a signed-in token pair."""
    user = User(
        email=email,
        password_hash=await hash_password_async(password),
        first_name=first_name,
        last_name=last_name,
    )
    session.add(user)

    try:
        await session.flush()
    except IntegrityError as exc:
        # ensure_email_free is not atomic. Two simultaneous registrations for
        # the same address both pass it and the unique index on lower(email)
        # catches the loser, which should still read as a conflict rather than
        # a 500.
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_TAKEN) from exc

    verification_token = await issue_email_verification_token(session, user)
    # Queued before issue_tokens, whose commit is the one that lands all three.
    job_id = queue_verification_email(session, user, verification_token)
    tokens = await issue_tokens(session, user)
    return user, job_id, tokens


async def verify_email(session: AsyncSession, raw_token: str) -> None:
    now = dt.datetime.now(dt.UTC)
    user = await _consume_one_time_token(
        session,
        EmailVerificationToken,
        raw_token,
        now,
        "Verification link is invalid or expired.",
    )
    user.email_verified = True
    await _spend_remaining_tokens(session, EmailVerificationToken, user, now)
    await session.commit()


async def start_email_verification(session: AsyncSession, email: str) -> uuid.UUID | None:
    """Queue a new verification link for an unverified account, returning the
    job's id, or None.

    None covers both an unknown address and an already verified one, and the
    route answers them identically so neither is revealed.
    """
    user = await user_by_email(session, email)
    if user is None or user.email_verified:
        return None
    raw_token = await issue_email_verification_token(session, user)
    job_id = queue_verification_email(session, user, raw_token)
    await session.commit()
    return job_id


async def start_password_reset(session: AsyncSession, email: str) -> uuid.UUID | None:
    """Queue a reset link for an account that can use one, returning the job's
    id, or None.

    Only a verified address gets one, since a reset link is proof of owning the
    inbox and an unverified row has never shown that. An account with no
    password has nothing to reset. As with verification, None is answered
    exactly like success.
    """
    user = await user_by_email(session, email)
    if user is None or not user.email_verified or user.password_hash is None:
        return None
    raw_token = await issue_password_reset_token(session, user)
    job_id = queue_password_reset_email(session, user, raw_token)
    await session.commit()
    return job_id


async def reset_password(session: AsyncSession, raw_token: str, new_password: str) -> None:
    """Set the new password and sign every session out, the caller's included,
    since whoever asked for the reset may not be the one who was signed in."""
    now = dt.datetime.now(dt.UTC)
    user = await _consume_one_time_token(
        session,
        PasswordResetToken,
        raw_token,
        now,
        "Password reset link is invalid or expired.",
    )
    user.password_hash = await hash_password_async(new_password)
    await _spend_remaining_tokens(session, PasswordResetToken, user, now)
    await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    await session.commit()


async def list_sessions(
    session: AsyncSession, user: User, current_session_id: uuid.UUID | None
) -> list[SessionOut]:
    """Every live session family, newest sign-in first.

    A session's age is when its first refresh token was issued, not its latest
    rotation, so the list reads as when each device signed in.
    """
    now = dt.datetime.now(dt.UTC)
    first_created = func.min(RefreshToken.created_at).label("created_at")
    rows = await session.execute(
        select(RefreshToken.session_id, first_created)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
        .group_by(RefreshToken.session_id)
        .order_by(first_created.desc())
    )
    return [
        SessionOut(
            session_id=session_id,
            created_at=created_at,
            is_current=session_id == current_session_id,
        )
        for session_id, created_at in rows
    ]


async def revoke_session(session: AsyncSession, user: User, session_id: uuid.UUID) -> None:
    result = await session.execute(
        delete(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.session_id == session_id)
        .returning(RefreshToken.id)
    )
    if result.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    await session.commit()


async def revoke_other_sessions(session: AsyncSession, user: User, keep: uuid.UUID) -> None:
    await session.execute(
        delete(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.session_id != keep,
        )
    )
    await session.commit()


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    """The account these credentials open, or a 401 that says nothing more.

    Same message whether the email is unknown, the account has no password or
    the password is wrong, and each of those burns the same time as a real
    check. Replying quickly for an unknown address and slowly for a known one
    leaks exactly what the shared message is trying to hide.
    """
    user = await user_by_email(session, email.strip())

    # A Google-only account has no password to compare against, and passing
    # None to the verifier raises rather than returning False. Replying "this
    # account signs in with Google" would say that the address exists.
    if (
        user is None
        or user.password_hash is None
        or not await verify_password_async(password, user.password_hash)
    ):
        await waste_time_like_a_verify()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_BAD_LOGIN)
    return user


def _fill_missing_names(user: User, identity: GoogleIdentity) -> None:
    """Names are filled in if the account never had them, and left alone if it
    did. Google is not the authority on what somebody is called here:
    overwriting on every sign in would undo a name the user set in Forkast."""
    if user.first_name is None and identity.first_name:
        user.first_name = identity.first_name
    if user.last_name is None and identity.last_name:
        user.last_name = identity.last_name


async def _user_for_google_identity(
    session: AsyncSession, identity: GoogleIdentity
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
    person *only if* nobody registered that address first to squat on it: a
    password account with an unverified email is not proven to belong to
    whoever is holding this Google token, it is only proven to belong to
    whoever typed the address into the register form. Google verifying the
    address here is the first real proof this row has ever had, so an
    unverified row is folded into the Google identity rather than merely
    linked to it: the squatter's password stops working and every refresh
    token issued to it dies, since either one would otherwise still open an
    account that address's real owner just proved is theirs. An already
    verified row has no such gap -- its password was already backed by a
    proven address -- so it only gains Google as a second door, same as
    before. This is only safe because verify_google_id_token refuses a token
    whose email Google has not verified; without that check this branch would
    hand somebody else's account to whoever could put their address in a Google
    profile.

    Neither: a new account, with no password. This is the only way a row with a
    null password_hash is ever created.
    """
    by_sub = await session.scalar(select(User).where(User.google_sub == identity.subject))
    if by_sub is not None:
        _fill_missing_names(by_sub, identity)
        return by_sub, False

    by_email = await user_by_email(session, identity.email)
    if by_email is not None:
        by_email.google_sub = identity.subject
        _fill_missing_names(by_email, identity)
        if not by_email.email_verified:
            # This row's only prior claim to the address was an unverified
            # register call, which anyone could have made. Google verifying
            # the address is what actually proves ownership, so whatever the
            # squatter set up under that claim is torn down now: the
            # password they chose stops working, and every refresh token
            # already issued to it -- which could otherwise keep a session
            # alive under the real owner's account -- is revoked.
            by_email.password_hash = None
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id == by_email.id))
            by_email.email_verified = True
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


async def sign_in_with_google(
    session: AsyncSession, identity: GoogleIdentity
) -> tuple[TokenPair, bool]:
    """Tokens for the account this verified identity names, and whether that
    account was created by this call."""
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

    return await issue_tokens(session, user), created


async def _revoke_family_on_reuse(
    session: AsyncSession, session_id: uuid.UUID, now: dt.datetime
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


async def _is_timeout_retry(session: AsyncSession, reused: RefreshToken, now: dt.datetime) -> bool:
    """Whether a spent token being presented again looks like a client retry.

    Only within the grace period, and only when the client is still using a
    valid newer token either in the same session or in another live session.
    If neither is true, the stale token is a leak.
    """
    if reused.revoked_at is None:
        return False
    leeway = dt.timedelta(seconds=get_settings().refresh_reuse_leeway_seconds)
    if now - reused.revoked_at > leeway:
        return False

    later_rotation = await session.scalar(
        select(RefreshToken).where(
            RefreshToken.user_id == reused.user_id,
            RefreshToken.session_id == reused.session_id,
            RefreshToken.token_hash != reused.token_hash,
            RefreshToken.revoked_at.is_not(None),
            RefreshToken.revoked_at > reused.revoked_at,
        )
    )
    other_live_session = await session.scalar(
        select(RefreshToken).where(
            RefreshToken.user_id == reused.user_id,
            RefreshToken.session_id != reused.session_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
    )
    return later_rotation is not None or other_live_session is not None


async def _answer_unclaimable_token(
    session: AsyncSession, token_hash: str, now: dt.datetime
) -> TokenPair:
    """A refresh token that could not be claimed: a retry, a leak, or nothing.

    Either the token never existed, or it did and has already been spent. A
    retry within the grace period is a client-side timeout, not a leak, so the
    same session gets a fresh pair rather than every live token for the
    account getting logged out.
    """
    reused = await session.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_not(None),
        )
    )
    if reused is not None:
        if await _is_timeout_retry(session, reused, now):
            user = await session.get(User, reused.user_id)
            if user is not None:
                return await issue_tokens(session, user, session_id=reused.session_id)
        await _revoke_family_on_reuse(session, reused.session_id, now)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_BAD_REFRESH)


async def rotate_refresh_token(session: AsyncSession, raw_refresh: str) -> TokenPair:
    token_hash = hash_refresh_token(raw_refresh)
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
        .returning(RefreshToken.user_id, RefreshToken.session_id)
    )
    row = claimed.first()
    if row is None:
        return await _answer_unclaimable_token(session, token_hash, now)

    user = await session.get(User, row[0])
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_BAD_REFRESH)

    # The same session continues across the rotation, so the client is not
    # treated as having signed in again and access tokens keep naming one
    # session for the life of that sign-in.
    return await issue_tokens(session, user, session_id=row[1])


async def log_out(session: AsyncSession, raw_refresh: str) -> None:
    token_hash = hash_refresh_token(raw_refresh)
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
