"""Declarative base, naming convention, and shared column helpers."""

from __future__ import annotations

import enum
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
        name=name,
        length=length,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


def new_uuid7() -> uuid.UUID:
    """Client-side UUIDv7 (stdlib on Python 3.14).

    Generated in the application rather than by the `uuidv7()` server default so
    a row's id is known before the INSERT returns -- which is what offline-capable
    logging needs. The server default remains as a safety net.
    """
    return uuid.uuid7()
