"""Normalisation for the short, single-line strings a user types in.

Every free-text field in the API (dish name, restaurant name, area, search
terms) is built with one of the two factories below rather than being a bare
``str``. They solve two problems that were each producing a wrong answer:

* **NUL bytes reached PostgreSQL.** ``text`` cannot hold ``\\x00``, so a dish
  name of ``"a\\x00b"`` made it past pydantic, past SQLAlchemy, and died inside
  asyncpg as ``CharacterNotInRepertoireError`` -- surfacing to the client as a
  500 with no explanation and dropping the pooled connection on the way out.
  It is a malformed request and has to read as one. The check covers the whole
  C0 range and DEL, not just NUL: these are one-line fields, so a newline or a
  bell character in a restaurant name is a bug or an attack, never a real name.

* **Length bounds measured the wrong string.** ``Field(min_length=1)`` counts
  the raw value, so ``"   "`` passed it and the handler's ``.strip()`` then
  stored an empty name. Stripping *before* the bound applies means the bound
  constrains what actually gets written. It also removes the need for handlers
  to strip by hand, which they were doing inconsistently: ``POST /logs``
  stripped ``dish_name`` but ``PATCH`` did not, and neither stripped ``area``,
  so "  Clifton  " and "Clifton" became two different areas on the map.

These are factories rather than plain aliases because of how pydantic composes
``Annotated`` metadata. A length constraint applied to the *outside* of an
optional field is handed the ``None`` that ``_clean_optional`` produced and
raises ``TypeError: Unable to apply constraint 'max_length' to supplied value
None`` -- at request time, as a 500. Building the constraint into the ``str``
branch of the union keeps the bound where it belongs and leaves ``None`` alone.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BeforeValidator, StringConstraints

# C0 controls plus DEL. Tab, newline and carriage return are included
# deliberately: nothing these fields describe is more than one line.
_FORBIDDEN = frozenset(chr(c) for c in range(0x20)) | {chr(0x7F)}


def _clean(value: object) -> object:
    """Strip surrounding whitespace; reject control characters.

    Non-str input passes through untouched so pydantic still reports its own
    "input should be a valid string" rather than a confusing error from here.
    """
    if not isinstance(value, str):
        return value
    if not _FORBIDDEN.isdisjoint(value):
        raise ValueError("must not contain control characters")
    return value.strip()


def _clean_optional(value: object) -> object:
    cleaned = _clean(value)
    if isinstance(cleaned, str) and not cleaned:
        return None
    return cleaned


def text_field(*, max_length: int, min_length: int = 1) -> Any:
    """A required single-line string. Whitespace-only is a length error."""
    return Annotated[
        Annotated[str, StringConstraints(min_length=min_length, max_length=max_length)],
        BeforeValidator(_clean),
    ]


def optional_text_field(*, max_length: int) -> Any:
    """An optional single-line string. Blank folds to ``None``.

    Blank meaning "not given" rather than "the empty string" keeps every reader
    downstream from having to check for two spellings of absent, and makes
    ``{"area": ""}`` in a PATCH clear the column, which is what a user emptying
    the box means.
    """
    return Annotated[
        Annotated[str, StringConstraints(max_length=max_length)] | None,
        BeforeValidator(_clean_optional),
    ]
