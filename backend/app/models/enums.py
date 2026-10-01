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


class EatingOutFrequency(str, enum.Enum):
    """Answered once, during onboarding. Self-reported rather than counted from
    restaurant logs, because it is asked before there is any history to count
    from at all -- the whole point is to personalize the plan generator's tone
    from day one rather than only once enough logs have accumulated."""

    rarely = "rarely"
    sometimes = "sometimes"
    often = "often"


class JobStatus(str, enum.Enum):
    """Where a row in the jobs table is in its life.

    pending waits for run_at; running is claimed by a worker (locked_at says
    since when); done finished; dead_letter ran out of attempts and is left for
    a person to look at rather than retried forever.
    """

    pending = "pending"
    running = "running"
    done = "done"
    dead_letter = "dead_letter"


class BiggestStruggle(str, enum.Enum):
    """What someone says trips them up most, asked once at onboarding. Feeds
    the plan generator's tone rather than any calculation: a cravings answer
    and a no-time-to-cook answer call for different coaching, not different
    numbers."""

    cravings = "cravings"
    portion_size = "portion_size"
    eating_out = "eating_out"
    consistency = "consistency"
    knowledge = "knowledge"
