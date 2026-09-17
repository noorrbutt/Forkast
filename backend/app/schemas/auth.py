"""Auth and user request/response models."""

from __future__ import annotations

import datetime as dt
import uuid
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

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
    # Computed by the database as part of the same SELECT, so reading a profile
    # never loads a byte of image data to answer it.
    has_avatar: bool = False
    created_at: dt.datetime


class AccountDelete(BaseModel):
    """Deleting an account asks for the password again.

    Not because the session is in doubt, but because this is irreversible and a
    phone left unlocked on a table is the realistic threat. It is the same
    reason the action is a separate endpoint rather than a flag on PATCH /me.
    """

    password: str


class PasswordChange(BaseModel):
    """Changing a password asks for the current one too.

    The access token already says who this is. The current password says it is
    the account holder rather than whoever picked the phone up, which is the
    same reason deleting an account asks for it.
    """

    current_password: str = Field(min_length=1, max_length=256)
    # The floor registration already enforces. A change must not be a side door
    # to a weaker password than signing up would have accepted.
    new_password: str = Field(min_length=8, max_length=256)


class UserUpdate(BaseModel):
    goal: Goal | None = None
    timezone: str | None = Field(default=None, max_length=64)
    # Matches ck_users_calorie_target_plausible, so a stray digit is refused
    # with a 422 rather than a 500 from the database. The floor is 0 rather
    # than a guessed minimum: see the constraint in models/user.py.
    daily_calorie_target: int | None = Field(default=None, ge=0, le=10_000)

    @model_validator(mode="after")
    def _null_only_where_the_column_is_nullable(self) -> "UserUpdate":
        """Refuse an explicit null for a column that cannot hold one.

        Every field here is optional, which is what makes a PATCH a PATCH: an
        absent field means "leave this alone". A field present and null is a
        different instruction, "clear this", and the only column on users that
        can actually be cleared is the daily target. Sending null for goal or
        timezone would set a NOT NULL column to null and surface as a 500 from
        the database, so it is refused here with a field path instead.
        """
        for field in ("goal", "timezone"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self

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
