"""A static table of Pakistani/desi dishes, used to ground calorie estimation.

Separate from app/seed/data.py's DISH_NAMES on purpose: that list exists to
seed demo log history and only ever carries a category slug and a free-text
name. This table exists to make text and photo estimation sensible for a
Karachi menu, so it carries a dish's own narrower calorie range, its usual
unit and typical quantity, and the roman-urdu spellings people actually type.

A dish's own kcal range is deliberately NOT one-unit-per-roti precise. It
follows the same convention FOOD_CATEGORIES already uses: the figures describe
a *typical serving* -- for "roti" that is `typical_qty` (2) pieces, not one --
so a dish range nests inside its category's range the same way the project's
own calorie-range convention already expects, and `finalise_estimate`'s clamp
behaves identically whether the AI was grounded by this table or not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_WORD_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True, slots=True)
class DesiDish:
    name: str
    aliases: tuple[str, ...]
    category_slug: str
    kcal_min: int
    kcal_max: int
    # roti|katori|plate|piece|cup|glass|serving
    unit: str
    typical_qty: float


# Calorie ranges here are approximate typical values, deliberately widened
# whenever the exact figure for a dish is unclear. Every range is checked
# against its category's own range in tests/test_desi.py; a few sit close to
# the category floor or ceiling because the dish genuinely runs light or rich
# within its category (see the summary of this change for the specific rows).
DESI_DISHES: tuple[DesiDish, ...] = (
    # Bare generic entries, one per dish family: someone who types just
    # "biryani" or "nihari" with no qualifier is not wrong, and before these
    # existed lookup() returned None for exactly that -- the single most
    # common thing anyone types -- while still matching every qualified
    # variant below. Each one defaults to the commonest, most unremarkable
    # version of the dish, with a range wide enough to span its own named
    # variants' own ranges and still sit inside the category range.
    DesiDish("biryani", ("biriyani", "briyani", "birayani"), "biryani", 600, 900, "plate", 1),
    DesiDish("karahi", ("qorma",), "karahi", 550, 900, "serving", 1),
    DesiDish("paratha", ("parantha",), "paratha", 280, 480, "piece", 1),
    DesiDish("nihari", ("nihaari",), "nihari", 600, 980, "plate", 1),
    DesiDish("chicken biryani", ("murgh biryani",), "biryani", 650, 850, "plate", 1),
    DesiDish("beef biryani", ("gosht biryani",), "biryani", 700, 900, "plate", 1),
    DesiDish("sindhi biryani", (), "biryani", 700, 900, "plate", 1),
    DesiDish("bombay biryani", (), "biryani", 650, 850, "plate", 1),
    DesiDish("vegetable biryani", ("veg biryani",), "biryani", 600, 750, "plate", 1),
    DesiDish("chicken karahi", ("murgh karahi",), "karahi", 600, 850, "serving", 1),
    DesiDish("mutton karahi", ("gosht karahi",), "karahi", 650, 900, "serving", 1),
    DesiDish("white karahi", ("malai karahi",), "karahi", 700, 900, "serving", 1),
    DesiDish("qeema karahi", ("kheema karahi",), "karahi", 600, 850, "serving", 1),
    DesiDish("keema", ("qeema bhuna", "mince keema", "kheema"), "karahi", 550, 800, "serving", 1),
    DesiDish("achaari chicken", ("achari gosht",), "karahi", 600, 850, "serving", 1),
    DesiDish("beef nihari", ("gosht nihari",), "nihari", 650, 950, "plate", 1),
    DesiDish("nalli nihari", (), "nihari", 700, 980, "plate", 1),
    DesiDish("chicken nihari", ("murgh nihari",), "nihari", 600, 850, "plate", 1),
    DesiDish("maghaz nihari", (), "nihari", 650, 950, "plate", 1),
    DesiDish("haleem", ("daleem",), "haleem", 500, 700, "katori", 1),
    DesiDish("chicken haleem", ("murgh haleem",), "haleem", 480, 680, "katori", 1),
    DesiDish("harees", (), "haleem", 450, 650, "katori", 1),
    DesiDish("seekh kebab", ("sikh kabab",), "bbq_tikka", 450, 650, "piece", 4),
    DesiDish("chicken tikka", ("murgh tikka",), "bbq_tikka", 450, 650, "piece", 2),
    DesiDish("malai boti", ("malai tikka",), "bbq_tikka", 500, 700, "piece", 4),
    DesiDish("chicken boti", ("boti kebab",), "bbq_tikka", 450, 650, "piece", 4),
    DesiDish("reshmi kebab", (), "bbq_tikka", 450, 650, "piece", 4),
    DesiDish("tandoori chicken", ("tandoori murgh",), "bbq_tikka", 500, 700, "piece", 2),
    DesiDish("chapli kebab", (), "bbq_tikka", 500, 700, "piece", 2),
    DesiDish("shami kebab", (), "bbq_tikka", 400, 600, "piece", 3),
    DesiDish("plain paratha", ("sada paratha",), "paratha", 280, 350, "piece", 1),
    DesiDish("lachha paratha", ("laccha paratha",), "paratha", 320, 420, "piece", 1),
    DesiDish("aloo paratha", ("potato paratha",), "paratha", 350, 480, "piece", 1),
    DesiDish("keema paratha", ("qeema paratha",), "paratha", 380, 480, "piece", 1),
    DesiDish("roti", ("chapati", "phulka"), "paratha", 280, 380, "roti", 2),
    DesiDish("tandoori roti", (), "paratha", 300, 400, "roti", 2),
    DesiDish("naan", ("plain naan",), "paratha", 300, 420, "piece", 1),
    DesiDish("garlic naan", ("lehsun naan",), "paratha", 340, 460, "piece", 1),
    DesiDish("chana chaat", ("chickpea chaat",), "chaat", 280, 400, "katori", 1),
    DesiDish("dahi bhalla", ("dahi baray",), "chaat", 300, 430, "plate", 1),
    DesiDish("papri chaat", (), "chaat", 280, 400, "plate", 1),
    DesiDish("fruit chaat", (), "chaat", 250, 350, "katori", 1),
    DesiDish("samosa", ("aloo samosa", "chicken samosa"), "samosa_pakora", 300, 420, "piece", 2),
    DesiDish("pakora", ("mixed pakora", "veg pakora"), "samosa_pakora", 320, 480, "plate", 1),
    DesiDish("daal chawal", ("daal rice",), "daal_chawal", 400, 550, "plate", 1),
    DesiDish("chana daal chawal", (), "daal_chawal", 400, 550, "plate", 1),
    DesiDish("masoor daal chawal", (), "daal_chawal", 380, 520, "plate", 1),
    DesiDish("daal maash", ("maash daal",), "daal_chawal", 400, 550, "plate", 1),
    DesiDish("halwa puri", (), "halwa_puri", 750, 1050, "plate", 1),
    DesiDish("puri channa", ("channa puri",), "halwa_puri", 750, 1050, "plate", 1),
    DesiDish("gulab jamun", (), "dessert", 380, 520, "piece", 2),
    DesiDish("jalebi", (), "dessert", 400, 550, "serving", 3),
    DesiDish("kheer", (), "dessert", 380, 520, "katori", 1),
    DesiDish("sheer khurma", (), "dessert", 400, 560, "katori", 1),
    DesiDish("gajar halwa", ("carrot halwa",), "dessert", 420, 580, "katori", 1),
    DesiDish("ras malai", ("rasmalai",), "dessert", 400, 560, "piece", 2),
    DesiDish("sohan halwa", (), "dessert", 400, 550, "katori", 1),
    DesiDish("chai", ("doodh patti", "karak chai", "chai patti"), "tea_coffee", 90, 140, "cup", 1),
    DesiDish("doodh patti chai", (), "tea_coffee", 100, 150, "cup", 1),
    DesiDish("green tea", ("sabz chai",), "tea_coffee", 90, 100, "cup", 1),
    DesiDish("lassi", ("sweet lassi", "namkeen lassi"), "beverage", 200, 300, "glass", 1),
    DesiDish("mango lassi", (), "beverage", 220, 300, "glass", 1),
    DesiDish("rooh afza", ("sharbat",), "beverage", 170, 260, "glass", 1),
)


def _normalise(text: str) -> str:
    """Lowercase, punctuation stripped, whitespace collapsed to single spaces."""
    return " ".join(_WORD_RE.findall(text.lower()))


# Every alias (and the dish's own name counts as one) maps back to its dish,
# built once at import time. validate() below asserts there is no collision.
_ALIAS_INDEX: dict[str, DesiDish] = {}
for _dish in DESI_DISHES:
    for _alias in (_dish.name, *_dish.aliases):
        _ALIAS_INDEX[_normalise(_alias)] = _dish


def lookup(text: str) -> DesiDish | None:
    """The best DESI_DISHES match for free text, or None.

    Exact alias match first (case/punctuation insensitive), then a token
    subset match: an alias whose every word appears somewhere in `text`
    matches, and the longest such alias wins. No fuzzy/edit-distance library,
    by design -- a token subset catches "chicken karahi bhuna" against
    "chicken karahi" without pulling in a dependency for it.
    """
    normalised = _normalise(text)
    if not normalised:
        return None

    exact = _ALIAS_INDEX.get(normalised)
    if exact is not None:
        return exact

    tokens = set(normalised.split())
    best: DesiDish | None = None
    best_score = 0
    for alias, dish in _ALIAS_INDEX.items():
        alias_tokens = alias.split()
        token_set = set(alias_tokens)
        if token_set and token_set <= tokens and len(alias_tokens) > best_score:
            best = dish
            best_score = len(alias_tokens)
    return best


def suggest(text: str, *, limit: int = 10) -> list[DesiDish]:
    """Up to `limit` dishes whose name or an alias starts with or contains
    `text`, for the dish-hint autocomplete. Ranked by: starts-with before
    contains, then shorter alias (closer match) first. Empty `text` returns
    the table's own order, which is a reasonable default list of suggestions.
    """
    normalised = _normalise(text)
    if not normalised:
        return list(DESI_DISHES[:limit])

    scored: list[tuple[int, int, DesiDish]] = []
    seen: set[str] = set()
    for alias, dish in _ALIAS_INDEX.items():
        if dish.name in seen:
            continue
        if alias.startswith(normalised):
            rank = 0
        elif normalised in alias:
            rank = 1
        else:
            continue
        scored.append((rank, len(alias), dish))
        seen.add(dish.name)

    scored.sort(key=lambda row: (row[0], row[1]))
    return [dish for _, _, dish in scored[:limit]]


def validate() -> None:
    """Assert the invariants the lookup and the endpoint both rely on.

    Not run at import time, the same reasoning as app/seed/data.py's own
    validate(): a bad row should fail in the test suite, not partway through
    a request.
    """
    from app.seed.data import FOOD_CATEGORIES

    category_ranges = {c.slug: (c.base_calorie_min, c.base_calorie_max) for c in FOOD_CATEGORIES}

    seen_aliases: set[str] = set()
    for dish in DESI_DISHES:
        assert 0 < dish.kcal_min <= dish.kcal_max, f"bad range on {dish.name!r}"
        assert dish.typical_qty > 0, f"bad typical_qty on {dish.name!r}"
        assert dish.category_slug in category_ranges, (
            f"{dish.name!r} points at unknown category {dish.category_slug!r}"
        )
        cat_min, cat_max = category_ranges[dish.category_slug]
        assert cat_min <= dish.kcal_min and dish.kcal_max <= cat_max, (
            f"{dish.name!r} range {dish.kcal_min}-{dish.kcal_max} falls outside "
            f"its category {dish.category_slug!r} range {cat_min}-{cat_max}"
        )
        for alias in (dish.name, *dish.aliases):
            key = _normalise(alias)
            assert key not in seen_aliases, f"duplicate alias: {alias!r}"
            seen_aliases.add(key)
