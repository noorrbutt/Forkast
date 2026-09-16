"""Auth and user request/response models."""

from __future__ import annotations

import datetime as dt
import uuid
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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
    daily_calorie_target: int | None = None
    created_at: dt.datetime


class UserUpdate(BaseModel):
    goal: Goal | None = None
    timezone: str | None = Field(default=None, max_length=64)
    # Matches ck_users_calorie_target_plausible, so a stray digit is refused
    # with a 422 rather than a 500 from the database.
    daily_calorie_target: int | None = Field(default=None, ge=800, le=10_000)

    @field_validator("timezone")
    @classmethod
    def _must_be_a_real_timezone(cls, value: str | None) -> str | None:
        """Reject anything ZoneInfo cannot load.

        The streak calculation buckets logs into calendar days using this value,
        so an unusable string here would not fail now, it would fail later
        inside a feature that looks unrelated.
        """
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            raise ValueError("timezone cannot be blank")
        try:
            ZoneInfo(candidate)
        except Exception as exc:
            raise ValueError(f"unknown timezone {candidate!r}") from exc
        return candidate
