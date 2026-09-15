"""The seed reference data is content, so it gets checked like content."""

from __future__ import annotations

from app.seed import data


def test_the_seed_data_validates() -> None:
    data.validate()


def test_there_is_enough_breadth_to_be_useful() -> None:
    assert len(data.CUISINES) >= 8
    assert len(data.FOOD_CATEGORIES) >= 30
    assert len(data.RESTAURANTS) >= 5


def test_every_category_points_at_a_real_cuisine() -> None:
    slugs = {c.slug for c in data.CUISINES}
    for category in data.FOOD_CATEGORIES:
        assert category.cuisine_slug in slugs, category.slug


def test_every_cuisine_has_at_least_one_category() -> None:
    used = {c.cuisine_slug for c in data.FOOD_CATEGORIES}
    for cuisine in data.CUISINES:
        assert cuisine.slug in used, f"{cuisine.slug} has no categories, so it would be a dead tab"


def test_calorie_ranges_satisfy_the_database_constraint() -> None:
    """Mirrors ck_food_categories_calorie_range, so a bad row fails here first."""
    for category in data.FOOD_CATEGORIES:
        assert 0 < category.base_calorie_min <= category.base_calorie_max, category.slug


def test_calorie_ranges_are_wide_enough_to_be_worth_adjusting() -> None:
    """If the range is too narrow there is nothing for the AI to place a dish in."""
    for category in data.FOOD_CATEGORIES:
        ratio = category.base_calorie_max / category.base_calorie_min
        assert 1.2 <= ratio <= 2.5, f"{category.slug} range ratio {ratio:.2f} looks wrong"


def test_the_junk_split_is_a_judgement_not_a_calorie_threshold() -> None:
    """A diary, not a clinical tracker: a rich meal is still just dinner."""
    by_slug = {c.slug: c for c in data.FOOD_CATEGORIES}

    for slug in ("biryani", "karahi", "nihari"):
        assert slug in by_slug and not by_slug[slug].is_junk, f"{slug} should not be junk"

    junk_count = sum(1 for c in data.FOOD_CATEGORIES if c.is_junk)
    assert 0 < junk_count < len(data.FOOD_CATEGORIES), "the junk flag must actually discriminate"


def test_dish_names_line_up_with_categories() -> None:
    category_slugs = {c.slug for c in data.FOOD_CATEGORIES}

    for slug, names in data.DISH_NAMES.items():
        assert slug in category_slugs, f"{slug} has dish names but is not a category"
        assert names, f"{slug} has an empty dish list"
        assert len(set(names)) == len(names), f"{slug} has duplicate dish names"


def test_restaurant_coordinates_are_actually_in_karachi() -> None:
    for restaurant in data.RESTAURANTS:
        assert 24.6 <= restaurant.latitude <= 25.2, restaurant.name
        assert 66.8 <= restaurant.longitude <= 67.4, restaurant.name
