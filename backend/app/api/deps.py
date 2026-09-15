"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.services.security import decode_access_token

# HTTPBearer rather than OAuth2PasswordBearer: the mobile client posts JSON to
# /auth/login, not an OAuth2 form, so the form flow would only add noise to the
# generated docs.
bearer_scheme = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]

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

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise _UNAUTHORIZED

    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        # The token verified but the account is gone. Same 401, no hint.
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
