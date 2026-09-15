"""Auth and user request/response models."""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import Goal


class RegisterRequest(BaseModel):
    email: EmailStr
    # Argon2 has no practical upper length limit (unlike bcrypt, which raises
    # above 72 bytes), so the cap here is purely to reject nonsense payloads.
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    timezone: str
    goal: Goal
    created_at: dt.datetime


class UserUpdate(BaseModel):
    goal: Goal | None = None
    timezone: str | None = Field(default=None, max_length=64)
