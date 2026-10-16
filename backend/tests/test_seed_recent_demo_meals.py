"""The demo seed script's new flags: --keep-photoless, --with-burn, and
DEMO_PHOTO_DIR replacing a hardcoded personal path.
"""

from __future__ import annotations

import datetime as dt
import sys

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BurnLog, User
from scripts import seed_recent_demo_meals as script


@pytest.mark.parametrize(
    ("argv", "keep_photoless", "with_burn"),
    [
        ([], False, False),
        (["--keep-photoless"], True, False),
        (["--with-burn"], False, True),
        (["--keep-photoless", "--with-burn"], True, True),
    ],
)
def test_flag_parsing(
    monkeypatch: pytest.MonkeyPatch, argv: list[str], keep_photoless: bool, with_burn: bool
) -> None:
    monkeypatch.setattr(sys, "argv", ["seed_recent_demo_meals.py", *argv])

    parsed = script._parse_args()

    assert parsed.keep_photoless is keep_photoless
    assert parsed.with_burn is with_burn


def test_an_unset_env_value_resolves_to_no_photo_dir() -> None:
    assert script._resolve_photo_dir(None) is None
    assert script._resolve_photo_dir("") is None


def test_a_photo_dir_that_does_not_exist_resolves_to_none(tmp_path) -> None:
    missing = tmp_path / "does-not-exist"

    assert script._resolve_photo_dir(str(missing)) is None


def test_a_real_directory_resolves_to_itself(tmp_path) -> None:
    assert script._resolve_photo_dir(str(tmp_path)) == tmp_path


async def test_burn_logs_are_upserted_not_duplicated(
    session: AsyncSession, auth_client: AsyncClient, fixture_email: str
) -> None:
    """Running the burn step twice must leave one row per day, matching
    PUT /burn's own upsert shape rather than inserting a second row."""
    user = await session.scalar(select(User).where(User.email == fixture_email))
    assert user is not None

    first_count = await script._add_burn_logs(session, user)
    await session.commit()
    second_count = await script._add_burn_logs(session, user)
    await session.commit()

    assert first_count == script.BURN_HISTORY_DAYS
    assert second_count == script.BURN_HISTORY_DAYS

    rows = (await session.scalars(select(BurnLog).where(BurnLog.user_id == user.id))).all()
    assert len(rows) == script.BURN_HISTORY_DAYS


async def test_burn_logs_are_deterministic_across_runs(
    session: AsyncSession, auth_client: AsyncClient, fixture_email: str
) -> None:
    """The same day gets the same figure on a rerun -- idempotent in the
    sense that matters for a demo seed, not merely "does not error twice"."""
    user = await session.scalar(select(User).where(User.email == fixture_email))
    assert user is not None

    await script._add_burn_logs(session, user)
    await session.commit()
    first = {
        row.day: row.calories
        for row in (await session.scalars(select(BurnLog).where(BurnLog.user_id == user.id))).all()
    }

    await script._add_burn_logs(session, user)
    await session.commit()
    second = {
        row.day: row.calories
        for row in (await session.scalars(select(BurnLog).where(BurnLog.user_id == user.id))).all()
    }

    assert first == second


async def test_burn_logs_cover_the_most_recent_days(
    session: AsyncSession, auth_client: AsyncClient, fixture_email: str
) -> None:
    user = await session.scalar(select(User).where(User.email == fixture_email))
    assert user is not None

    await script._add_burn_logs(session, user)
    await session.commit()

    today = dt.datetime.now(dt.UTC).date()
    rows = (await session.scalars(select(BurnLog).where(BurnLog.user_id == user.id))).all()
    days = {row.day for row in rows}
    assert today in days or (today - dt.timedelta(days=1)) in days


async def test_burn_calories_stay_within_the_plausible_range(
    session: AsyncSession, auth_client: AsyncClient, fixture_email: str
) -> None:
    """Mirrors the calories_plausible CHECK constraint on burn_logs."""
    user = await session.scalar(select(User).where(User.email == fixture_email))
    assert user is not None

    await script._add_burn_logs(session, user)
    await session.commit()

    rows = (await session.scalars(select(BurnLog).where(BurnLog.user_id == user.id))).all()
    for row in rows:
        assert 0 <= row.calories <= 10_000


async def test_removing_previous_curated_meals_is_scoped_to_their_own_dish_names(
    session: AsyncSession, auth_client: AsyncClient, fixture_email: str
) -> None:
    """A dish name outside CURATED_MEALS must survive a rerun untouched."""
    from app.models import FoodCategory, FoodLog

    user = await session.scalar(select(User).where(User.email == fixture_email))
    assert user is not None
    category = await session.scalar(select(FoodCategory).limit(1))
    assert category is not None

    other = FoodLog(
        user_id=user.id,
        dish_name="something totally unrelated",
        category_id=category.id,
        rating=4,
        serving_size="medium",
        estimated_calories=500,
    )
    session.add(other)
    await session.commit()

    await script._remove_previous_curated_meals(session, user)
    await session.commit()

    survivors = (
        await session.scalars(
            select(func.count())
            .select_from(FoodLog)
            .where(FoodLog.user_id == user.id, FoodLog.dish_name == "something totally unrelated")
        )
    ).one()
    assert survivors == 1
