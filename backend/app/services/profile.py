"""Everything addressed at /me: the export, edits, the password, the profile
picture and closing the account.

Verifying a Google ID token stays at the route, which hands the identity in;
everything here works on a database session and plain values.
"""

from __future__ import annotations

import csv
import io
import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models import BurnLog, FoodLog, RefreshToken, User, UserAvatar
from app.schemas.auth import ExportBurnLog, ExportLog, ExportOut, UserUpdate
from app.services.auth import (
    issue_email_verification_token,
    queue_verification_email,
    user_by_email,
)
from app.services.google import GoogleIdentity
from app.services.rate_limit import RateLimiter, account_identity
from app.services.security import hash_password_async, verify_password_async

_EMAIL_TAKEN = "An account with that email already exists"

# Cells that open with any of these are live formulas to Excel, Sheets and
# Numbers, and every one of these fields is a string a user chose (a dish
# name, a burn note): "=HYPERLINK(\"http://evil\",\"x\")" as a dish name runs
# the moment the export is opened. A leading apostrophe makes every one of
# those readers show the text as-typed instead of evaluating it, and it never
# shows up in the opened cell itself.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value: str | None) -> str | None:
    if value is not None and value.startswith(_CSV_FORMULA_PREFIXES):
        return f"'{value}"
    return value


async def build_export(session: AsyncSession, user: User) -> ExportOut:
    """The caller's meals and burns, newest first.

    Photo bytes are left out of the logs on purpose; the export is something to
    hand to a regulator or keep, not a backup of every image.
    """
    log_rows = await session.scalars(
        select(FoodLog)
        .where(FoodLog.user_id == user.id)
        .order_by(FoodLog.created_at.desc())
        .options(selectinload(FoodLog.category), selectinload(FoodLog.restaurant))
    )
    logs = [
        ExportLog(
            id=log.id,
            dish_name=log.dish_name,
            category_name=getattr(log.category, "name", None),
            restaurant_name=getattr(log.restaurant, "name", None),
            estimated_calories=getattr(log, "estimated_calories", None),
            created_at=log.created_at,
        )
        for log in log_rows
    ]

    burn_rows = await session.scalars(
        select(BurnLog).where(BurnLog.user_id == user.id).order_by(BurnLog.created_at.desc())
    )
    burn_logs = [
        ExportBurnLog(
            id=burn.id,
            calories=getattr(burn, "calories", None),
            created_at=getattr(burn, "created_at", None),
            note=getattr(burn, "note", None),
        )
        for burn in burn_rows
    ]
    return ExportOut(food_logs=logs, burn_logs=burn_logs)


def export_as_csv(export: ExportOut) -> bytes:
    """Both tables in one file, one after the other, each under its own name."""
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["food_logs"])
    writer.writerow(
        ["id", "dish_name", "category_name", "restaurant_name", "estimated_calories", "created_at"]
    )
    for log in export.food_logs:
        writer.writerow(
            [
                log.id,
                _csv_safe(log.dish_name),
                _csv_safe(log.category_name),
                _csv_safe(log.restaurant_name),
                log.estimated_calories,
                log.created_at.isoformat(),
            ]
        )
    writer.writerow([])
    writer.writerow(["burn_logs"])
    writer.writerow(["id", "calories", "created_at", "note"])
    for burn in export.burn_logs:
        writer.writerow(
            [
                burn.id,
                burn.calories,
                burn.created_at.isoformat() if burn.created_at else "",
                _csv_safe(burn.note) or "",
            ]
        )
    return stream.getvalue().encode("utf-8")


async def _change_email(
    session: AsyncSession, limiter: RateLimiter, user: User, new_email: str
) -> uuid.UUID:
    """Move the account to a new address, unverified, and queue a verification
    link to it on the same transaction, returning the job's id.

    email_verified means "this address was proved", which stops being true the
    instant the address changes. Google having verified the old one says
    nothing about who controls the new one, so this re-runs the registration
    flow rather than leaving the flag on or quietly flipping it back.
    """
    settings = get_settings()
    await limiter.hit(
        "email-change",
        account_identity(user.id),
        limit=settings.login_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )
    existing = await user_by_email(session, new_email.strip())
    if existing is not None and existing.id != user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_TAKEN)
    user.email = new_email.strip()
    user.email_verified = False
    raw_token = await issue_email_verification_token(session, user)
    return queue_verification_email(session, user, raw_token)


async def update_profile(
    session: AsyncSession, limiter: RateLimiter, user: User, payload: UserUpdate
) -> uuid.UUID | None:
    """Apply exactly the fields sent, nulls included, and return the id of the
    verification email queued if the address changed.

    exclude_unset is what separates "leave this alone" from "clear this". An
    `if value is not None` on top of it once collapsed the two back together,
    so clearing a daily target answered 200 and changed nothing. The fields
    that genuinely cannot take a null are refused by UserUpdate before here.
    """
    changes = payload.model_dump(exclude_unset=True)

    new_email = changes.pop("email", None)
    email_job_id: uuid.UUID | None = None
    if new_email is not None and new_email.strip().lower() != user.email.lower():
        email_job_id = await _change_email(session, limiter, user, new_email)

    for field, value in changes.items():
        setattr(user, field, value)

    try:
        await session.commit()
    except IntegrityError as exc:
        # The uniqueness check is not atomic, the same race register already
        # guards against.
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_TAKEN) from exc
    return email_job_id


async def throttle_password_check(limiter: RateLimiter, user: User) -> None:
    """One bucket for every route that asks for the current password.

    Throttled like a login, because that is what it is: a password guess, made
    by whoever is holding the phone. Shared between deletion and password
    change, since they are the same question asked twice and separate budgets
    would simply double the number of tries available.
    """
    settings = get_settings()
    await limiter.hit(
        "password-check",
        account_identity(user.id),
        limit=settings.login_rate_limit,
        window_seconds=settings.login_rate_window_seconds,
    )


async def confirm_deletion_by_password(user: User, password: str) -> None:
    if user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account signs in with Google and has no password, so "
                "confirm with Google instead. Nothing was deleted."
            ),
        )
    # The same constant time comparison login uses.
    if not await verify_password_async(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That password does not match, so nothing was deleted.",
        )


def confirm_deletion_by_google(user: User, identity: GoogleIdentity) -> None:
    """A token is only proof if it names this very account.

    Verifying the signature and stopping there would let anybody with any
    Google account delete whichever Forkast account their phone happened to be
    signed in to, which is the opposite of what this check is for.
    """
    if identity.subject != user.google_sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That is a different Google account, so nothing was deleted.",
        )


async def delete_account(session: AsyncSession, user: User) -> None:
    """Every table holding this user's own data cascades from users, refresh
    tokens included, which is what ends every other signed in device.
    Restaurants deliberately do not: they are a shared registry, so created_by
    is SET NULL and the place survives for everyone else who logged there."""
    await session.delete(user)
    await session.commit()


async def change_password(
    session: AsyncSession,
    user: User,
    *,
    current_password: str,
    new_password: str,
    caller_session: uuid.UUID | None,
) -> None:
    """Change the password, and sign every other device out."""
    # An account created through Google has no current password to be asked
    # for. 409 rather than 403, because the request is not wrong about a
    # value, it is wrong about the account.
    if user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account signs in with Google and has no password to change.",
        )

    # Asked for the same reason deletion asks: the session proves the phone,
    # not the person holding it.
    if not await verify_password_async(current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That password does not match, so nothing was changed.",
        )

    user.password_hash = await hash_password_async(new_password)

    # Every other session ends here; this one deliberately does not. Someone
    # changing a password is usually reacting to a device they no longer
    # control, so leaving the other sessions alive would defeat the point,
    # while ending this one too would drop the caller at a login screen the
    # moment they proved they knew both passwords.
    #
    # The other sessions' rows are deleted rather than stamped revoked_at, and
    # that is the part worth being careful about. A revoked row is exactly what
    # /auth/refresh reads as a leaked token chain, and its answer to that is to
    # revoke every live token on the account, this caller's included. Marking
    # the other devices revoked would therefore arm a trap: the next time any
    # of them refreshed, the person who had just changed their password would
    # be signed out by it. With no row at all those devices get the same plain
    # 401 a token that never existed gets, and their access tokens stop working
    # immediately, because get_current_user only accepts one whose session still
    # has a live refresh token. The caller's own rows, spent ones included, are
    # left exactly as they were, so reuse detection still guards the chain that
    # is actually in use.
    #
    # A caller_session of None means the token could not be read at all, and
    # that ends every session: a surprise here can only be too strict.
    ending = delete(RefreshToken).where(RefreshToken.user_id == user.id)
    if caller_session is not None:
        ending = ending.where(RefreshToken.session_id != caller_session)
    await session.execute(ending)

    await session.commit()


async def set_avatar(session: AsyncSession, user: User, data: bytes, content_type: str) -> None:
    """One picture per account: a second upload replaces the first in place."""
    existing = await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user.id))
    if existing is None:
        session.add(
            UserAvatar(
                user_id=user.id,
                content_type=content_type,
                byte_size=len(data),
                data=data,
            )
        )
    else:
        existing.content_type = content_type
        existing.byte_size = len(data)
        existing.data = data

    await session.commit()
    # has_avatar was answered by the SELECT that loaded this user, which ran
    # before the row above existed, so without a re-read the reply would still
    # say there is no picture.
    await session.refresh(user)


async def get_avatar(session: AsyncSession, user: User) -> UserAvatar:
    avatar = await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user.id))
    if avatar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No avatar on this account",
        )
    return avatar


async def delete_avatar(session: AsyncSession, user: User) -> None:
    avatar = await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user.id))
    # Removing a picture that is not there is the state the caller asked for, so
    # it is not an error.
    if avatar is not None:
        await session.delete(avatar)
        await session.commit()
