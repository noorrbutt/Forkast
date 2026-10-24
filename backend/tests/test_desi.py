"""The desi dish table, its lookup, and the /dishes endpoint."""

from __future__ import annotations

from httpx import AsyncClient

from app.services.ai import desi


def test_the_desi_table_validates() -> None:
    desi.validate()


def test_there_is_enough_breadth_to_be_useful() -> None:
    assert len(desi.DESI_DISHES) >= 40


def test_lookup_finds_an_exact_alias_case_and_punctuation_insensitive() -> None:
    match = desi.lookup("Beef Nihari!")
    assert match is not None and match.name == "beef nihari"


def test_lookup_finds_a_roman_urdu_alias() -> None:
    match = desi.lookup("biriyani")
    assert match is not None and match.name == "biryani"


def test_lookup_finds_other_common_misspellings() -> None:
    for text, expected in [
        ("briyani", "biryani"),
        ("birayani", "biryani"),
        ("nihaari", "nihari"),
        ("parantha", "paratha"),
        ("qorma", "karahi"),
        ("kheema", "keema"),
    ]:
        match = desi.lookup(text)
        assert match is not None and match.name == expected, text


def test_bare_dish_names_match_their_own_generic_entry() -> None:
    for text in ("biryani", "karahi", "paratha", "nihari"):
        match = desi.lookup(text)
        assert match is not None and match.name == text, text


def test_lookup_finds_karak_chai() -> None:
    match = desi.lookup("karak chai")
    assert match is not None and match.name == "chai"


def test_lookup_token_subset_matches_a_longer_phrase() -> None:
    match = desi.lookup("home made chicken karahi with naan")
    assert match is not None and match.name == "chicken karahi"


def test_lookup_returns_none_for_nonsense() -> None:
    assert desi.lookup("zzzqqqxxx") is None


def test_lookup_returns_none_for_blank_text() -> None:
    assert desi.lookup("   ") is None


def test_every_dish_range_nests_inside_its_category_range() -> None:
    """Mirrors the assertion inside validate(), as a second, more visible test."""
    from app.seed.data import FOOD_CATEGORIES

    ranges = {c.slug: (c.base_calorie_min, c.base_calorie_max) for c in FOOD_CATEGORIES}
    for dish in desi.DESI_DISHES:
        cat_min, cat_max = ranges[dish.category_slug]
        assert cat_min <= dish.kcal_min <= dish.kcal_max <= cat_max, dish.name


def test_suggest_ranks_starts_with_before_contains() -> None:
    results = desi.suggest("chai")
    names = [d.name for d in results]
    assert names[0] == "chai"


def test_suggest_with_blank_text_returns_the_default_list() -> None:
    results = desi.suggest("", limit=5)
    assert len(results) == 5


def test_suggest_finds_common_misspellings() -> None:
    for text, expected in [("nihaari", "nihari"), ("biriyani", "biryani")]:
        names = [d.name for d in desi.suggest(text)]
        assert expected in names, text


def test_iftar_and_sehri_staples_are_in_the_table() -> None:
    names = {d.name for d in desi.DESI_DISHES}
    for name in (
        "dates",
        "nimbu pani",
        "falooda",
        "zarda",
        "sawaiyan",
        "anda paratha",
        "omelette",
        "daliya",
        "bun kabab",
        "chicken roll",
        "pulao",
        "chicken corn soup",
    ):
        assert name in names, name


def test_iftar_and_sehri_aliases_resolve() -> None:
    for text, expected in [
        ("khajoor", "dates"),
        ("khajur", "dates"),
        ("iftari", "dates"),
        ("dahi baray", "dahi bhalla"),
        ("dahi baira", "dahi bhalla"),
        ("nimbu paani", "nimbu pani"),
    ]:
        match = desi.lookup(text)
        assert match is not None and match.name == expected, text


def test_dates_typical_qty_is_three_pieces() -> None:
    dates = next(d for d in desi.DESI_DISHES if d.name == "dates")
    assert dates.unit == "piece"
    assert dates.typical_qty == 3


async def test_dishes_endpoint_returns_matches_with_a_real_category_id(
    auth_client: AsyncClient,
) -> None:
    categories = (await auth_client.get("/api/v1/categories")).json()
    nihari = next(c for c in categories if c["slug"] == "nihari")

    hits = (await auth_client.get("/api/v1/dishes", params={"q": "nihari"})).json()

    assert len(hits) > 0
    assert all(h["category_id"] == nihari["id"] for h in hits if "nihari" in h["name"])


async def test_dishes_endpoint_blank_query_returns_a_default_list(
    auth_client: AsyncClient,
) -> None:
    hits = (await auth_client.get("/api/v1/dishes")).json()
    assert 0 < len(hits) <= 10


async def test_dishes_endpoint_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/dishes")).status_code == 401


async def test_dishes_endpoint_limit_is_bounded(auth_client: AsyncClient) -> None:
    assert (await auth_client.get("/api/v1/dishes", params={"limit": 11})).status_code == 422
