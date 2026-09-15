"""Closed vocabularies stored as VARCHAR + CHECK (see base.str_enum)."""

from __future__ import annotations

import enum


class ServingSize(str, enum.Enum):
    small = "small"
    medium = "medium"
    large = "large"


class FriendScale(str, enum.Enum):
    """Who you ate with. Categorical rather than a 1-5 rating: three tappable
    chips are faster to answer than a vague 'company vibe' score."""

    solo = "solo"
    small_group = "small_group"
    squad = "squad"


class Goal(str, enum.Enum):
    cut = "cut"
    maintain = "maintain"
    bulk = "bulk"
