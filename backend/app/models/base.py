"""Declarative base, naming convention, and shared column helpers."""

from __future__ import annotations

import enum
import secrets
import time
import uuid
from typing import TypeVar

from sqlalchemy import Enum as SAEnum
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Stable, explicit constraint names so Alembic autogenerate produces clean,
# reversible migrations instead of anonymous constraints it cannot later target.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


_E = TypeVar("_E", bound=enum.Enum)


def str_enum(enum_cls: type[_E], name: str, length: int = 32) -> SAEnum:
    """A VARCHAR + named CHECK column, never a native PostgreSQL ENUM.

    Native PG enums are painful under Alembic: values can never be removed,
    ADD VALUE cannot be used in the transaction that created it, and Alembic
    issue #886 (still open) leaves the TYPE behind on drop_table -- so
    `downgrade base` followed by `upgrade head` fails with "type already
    exists". VARCHAR + CHECK is one drop-and-recreate to change and is clean
    by construction.

    `name=` is mandatory: with the "ck" naming convention above, an anonymous
    CHECK constraint raises during DDL generation.
    """
    return SAEnum(
        enum_cls,
        native_enum=False,
        # SQLAlchemy 2.0 defaults this to False, which quietly produces a bare
        # VARCHAR with no constraint at all. Without it the database happily
        # accepts serving_size = 'gigantic'.
        create_constraint=True,
        name=name,
        length=length,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


def new_uuid7() -> uuid.UUID:
    """Generate a UUIDv7, with a compatibility fallback for Python < 3.14.

    Python 3.13 does not expose `uuid.uuid7()`, but this project needs a v7 id
    before INSERTs return so offline logs can attach their row id immediately.
    The fallback keeps the canonical RFC 9562 layout: the first 48 bits are the
    Unix timestamp in milliseconds, the next 4 bits are version 7, and the RFC
    4122 variant bits remain set to ``10``.
    """
    try:
        return uuid.uuid7()
    except AttributeError:
        timestamp_ms = time.time_ns() // 1_000_000
        raw = bytearray(secrets.token_bytes(16))
        raw[0:6] = (timestamp_ms & ((1 << 48) - 1)).to_bytes(6, byteorder="big")
        raw[6] = 0x70 | (raw[6] & 0x0F)
        raw[8] = 0x80 | (raw[8] & 0x3F)
        return uuid.UUID(bytes=bytes(raw))
