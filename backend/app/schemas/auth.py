"""Auth and user request/response models."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated
from zoneinfo import ZoneInfo

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models.enums import Goal


def _required_name(value: str) -> str:
    """Trim a name and refuse one that was only whitespace.

    min_length on its own passes a field holding a single space, which would
    store a name that is not a name and render as a blank line wherever the
    account is shown.
    """
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("cannot be blank")
    return trimmed


RequiredName = Annotated[
    str,
    # Matched to users.first_name / users.last_name, which are String(80). The
    # validator runs after the length check, so a name of 80 spaces is refused
    # by the check above rather than stored as an empty string.
    Field(min_length=1, max_length=80),
    AfterValidator(_required_name),
]


class RegisterRequest(BaseModel):
    # Asked for, and required, since the sign up screen started asking. Existing
    # accounts have neither and the column is nullable for them; there is no
    # route by which a new account can arrive without both.
    first_name: RequiredName
    last_name: RequiredName
    email: EmailStr
    # Argon2 has no practical upper length limit (unlike bcrypt, which raises
    # above 72 bytes), so the cap here is purely to reject nonsense payloads.
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class GoogleAuthRequest(BaseModel):
    """What "Continue with Google" posts: the ID token, and nothing else.

    Deliberately not the email, the name or the Google id. Every one of those
    is inside the signed token already, and taking any of them from the request
    body would mean trusting a value the caller typed next to a signature that
    does not cover it.
    """

    id_token: str = Field(min_length=1, max_length=4096)


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
    # Null for every account made before names were asked for, and for a Google
    # account whose token carried no name claim. The clients treat null as "no
    # name" and fall back to the address, which is what they did for everyone
    # before this existed.
    first_name: str | None = None
    last_name: str | None = None
    timezone: str
    goal: Goal
    daily_calorie_target: int | None = None
    # Computed by the database as part of the same SELECT, so reading a profile
    # never loads a byte of image data to answer it.
    has_avatar: bool = False
    # Whether this account has a password at all. False for one created through
    # Google and never given one, and the client needs to know because there is
    # no password to ask such an account for before it deletes itself. The hash
    # itself is of course never sent.
    has_password: bool = True
    created_at: dt.datetime


class ExportLog(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dish_name: str
    category_name: str | None = None
    restaurant_name: str | None = None
    estimated_calories: int | None = None
    created_at: dt.datetime
    has_photo: bool = False


class ExportBurnLog(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    calories: int | None = None
    created_at: dt.datetime | None = None
    note: str | None = None


class ExportPlan(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    goal: str | None = None
    created_at: dt.datetime
    model: str | None = None
    generated_plan: dict


class DataExport(BaseModel):
    user: UserOut
    logs: list[ExportLog]
    burn_logs: list[ExportBurnLog]
    plans: list[ExportPlan]


class ExportOut(BaseModel):
    food_logs: list[ExportLog]
    burn_logs: list[ExportBurnLog]


class AccountDelete(BaseModel):
    """Deleting an account asks the holder to prove themselves again.

    Not because the session is in doubt, but because this is irreversible and a
    phone left unlocked on a table is the realistic threat. It is the same
    reason the action is a separate endpoint rather than a flag on PATCH /me.

    Two ways to prove it, because there are two kinds of account. One with a
    password answers with the password. One created through Google has no
    password to be asked for, so it answers with a fresh Google ID token, which
    means going through Google's own prompt again on the spot. Both are exactly
    one step, and neither is optional: an account that could be deleted on the
    session alone would be deletable by whoever picked the phone up.
    """

    password: str | None = None
    id_token: str | None = None

    @model_validator(mode="after")
    def _one_proof_or_the_other(self) -> AccountDelete:
        """Exactly one, never both and never neither.

        Refusing both together is not pedantry: with both present the route
        would have to pick one to check, and whichever it picked, the other
        would be a field a caller could send to no effect while believing it
        was doing the work.
        """
        given = [f for f in (self.password, self.id_token) if f]
        if len(given) != 1:
            raise ValueError("send either password or id_token, and only one of them")
        return self


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
    def _null_only_where_the_column_is_nullable(self) -> UserUpdate:
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
