"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_session_factory
from app.models import RefreshToken, User
from app.services.rate_limit import RateLimiter
from app.services.security import decode_access_token

# HTTPBearer rather than OAuth2PasswordBearer: the mobile client posts JSON to
# /auth/login, not an OAuth2 form, so the form flow would only add noise to the
# generated docs.
bearer_scheme = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_rate_limiter(
    session_factory=Depends(get_session_factory),
) -> RateLimiter:
    return RateLimiter(session_factory)


RateLimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORIZED

    claims = decode_access_token(credentials.credentials)
    if claims is None:
        raise _UNAUTHORIZED

    # One query, not two. The join is what enforces that the session behind this
    # token is still live: signing out revokes every refresh token carrying that
    # session_id, so the access token issued beside it stops working at the same
    # moment instead of outliving the logout by up to half an hour.
    user = await session.scalar(
        select(User)
        .join(RefreshToken, RefreshToken.user_id == User.id)
        .where(
            User.id == claims.user_id,
            RefreshToken.session_id == claims.session_id,
            RefreshToken.revoked_at.is_(None),
        )
        .limit(1)
    )
    if user is None:
        # Either the account is gone or the session was ended. Same 401, no hint.
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
