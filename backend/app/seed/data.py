"""Reference data the app ships with: cuisines, categories, restaurants, dishes.

Pure data and pure functions. Nothing here touches the database or imports a
model, so the seeder, the tests and a future export script can all read it
without dragging SQLAlchemy in.

Two conventions worth knowing before editing:

* Calorie ranges are per typical *restaurant* serving in Karachi, not per 100g
  and not per home portion. They are deliberately wide (max sits roughly 1.5x
  to 1.8x min) because the range is the box the AI estimate has to stay inside:
  too narrow and "malai boti" and "tandoori boti" land on the same number.
* ``is_junk`` drives the junk vs non junk ratio on the dashboard, so it is a
  judgement call, not a calorie threshold. Deep fried snacks, fast food,
  desserts and sugary drinks are junk. A proper meal is not, however rich it
  is: biryani, karahi and nihari are dinner, not a moral failing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")


@dataclass(frozen=True, slots=True)
class CuisineSeed:
    """A head category: where a dish comes from."""

    slug: str
    name: str
    emoji: str
    sort_order: int


@dataclass(frozen=True, slots=True)
class CategorySeed:
    """A loggable category, owned by exactly one cuisine."""

    cuisine_slug: str
    slug: str
    name: str
    base_calorie_min: int
    base_calorie_max: int
    is_junk: bool


@dataclass(frozen=True, slots=True)
class RestaurantSeed:
    """A starter map pin. Users create the rest as they log."""

    name: str
    area: str
    latitude: float
    longitude: float


# Desi sorts first because it is what most of this app's users log most days.
# The rest are ordered by how often they show up in a Karachi food court, with
# the catch-all pinned last so it never competes with a real answer.
CUISINES: list[CuisineSeed] = [
    CuisineSeed("desi", "Desi", "\N{CURRY AND RICE}", 1),
    CuisineSeed("american", "American", "\N{HAMBURGER}", 2),
    CuisineSeed("italian", "Italian", "\N{SPAGHETTI}", 3),
    CuisineSeed("chinese", "Chinese", "\N{TAKEOUT BOX}", 4),
    CuisineSeed("middle_eastern", "Middle Eastern", "\N{STUFFED FLATBREAD}", 5),
    CuisineSeed("japanese", "Japanese", "\N{SUSHI}", 6),
    CuisineSeed("korean", "Korean", "\N{POT OF FOOD}", 7),
    CuisineSeed("thai", "Thai", "\N{HOT PEPPER}", 8),
    CuisineSeed("mexican", "Mexican", "\N{TACO}", 9),
    CuisineSeed("continental", "Continental", "\N{FORK AND KNIFE WITH PLATE}", 10),
]

# Field order: cuisine_slug, slug, name, base_calorie_min, base_calorie_max.
FOOD_CATEGORIES: list[CategorySeed] = [
    # Desi. The heaviest weighting on purpose: this is the home cuisine, and a
    # single "Pakistani" bucket would make the whole diary useless.
    CategorySeed("desi", "biryani", "Biryani", 600, 950, is_junk=False),
    CategorySeed("desi", "karahi", "Karahi", 550, 900, is_junk=False),
    CategorySeed("desi", "nihari", "Nihari", 600, 980, is_junk=False),
    CategorySeed("desi", "haleem", "Haleem", 450, 750, is_junk=False),
    CategorySeed("desi", "bbq_tikka", "BBQ and Tikka", 400, 700, is_junk=False),
    CategorySeed("desi", "paratha", "Paratha", 280, 480, is_junk=False),
    CategorySeed("desi", "chaat", "Chaat", 250, 430, is_junk=False),
    CategorySeed("desi", "daal_chawal", "Daal Chawal", 380, 620, is_junk=False),
    # Halwa puri is deep fried bread plus a sugar and ghee dessert in one
    # plate, which is the clearest junk case in the desi list.
    CategorySeed("desi", "halwa_puri", "Halwa Puri", 700, 1150, is_junk=True),
    CategorySeed("desi", "samosa_pakora", "Samosa and Pakora", 300, 520, is_junk=True),
    # American. Mostly the fast food end, which is exactly why it is here.
    CategorySeed("american", "burger", "Burger", 550, 950, is_junk=True),
    CategorySeed("american", "fried_chicken", "Fried Chicken and Broast", 600, 980, is_junk=True),
    CategorySeed("american", "sandwich", "Sandwich", 400, 700, is_junk=False),
    CategorySeed("american", "fries", "Fries", 320, 540, is_junk=True),
    # Italian.
    CategorySeed("italian", "pasta", "Pasta", 550, 900, is_junk=False),
    CategorySeed("italian", "pizza", "Pizza", 600, 1000, is_junk=True),
    CategorySeed("italian", "lasagna", "Lasagna", 550, 880, is_junk=False),
    # Chinese, in the Karachi sense of the word rather than the Sichuan one.
    CategorySeed("chinese", "fried_rice", "Fried Rice", 450, 750, is_junk=False),
    CategorySeed("chinese", "chow_mein", "Chow Mein and Noodles", 480, 800, is_junk=False),
    # Manchurian is battered, deep fried and finished in a sweet sauce, so it
    # lands on the junk side even though it gets eaten as a main course.
    CategorySeed("chinese", "manchurian", "Manchurian", 500, 820, is_junk=True),
    # Middle Eastern.
    CategorySeed("middle_eastern", "shawarma", "Shawarma", 450, 780, is_junk=True),
    CategorySeed("middle_eastern", "hummus_mezze", "Hummus and Mezze", 320, 560, is_junk=False),
    CategorySeed("middle_eastern", "mandi", "Mandi and Kabsa", 700, 1100, is_junk=False),
    # Japanese.
    CategorySeed("japanese", "sushi", "Sushi", 300, 520, is_junk=False),
    CategorySeed("japanese", "ramen", "Ramen", 500, 850, is_junk=False),
    # Korean.
    CategorySeed("korean", "korean_bbq", "Korean BBQ", 600, 950, is_junk=False),
    CategorySeed("korean", "bibimbap", "Bibimbap", 550, 850, is_junk=False),
    # Thai.
    CategorySeed("thai", "thai_curry", "Thai Curry", 500, 820, is_junk=False),
    CategorySeed("thai", "pad_thai", "Pad Thai", 550, 900, is_junk=False),
    # Mexican.
    CategorySeed("mexican", "tacos", "Tacos", 400, 680, is_junk=False),
    CategorySeed("mexican", "burrito", "Burrito", 650, 1050, is_junk=False),
    # Continental, doubling as the catch-all. Everything that does not belong
    # to one kitchen (a bowl of soup, a coffee, a slice of cake) lives here.
    CategorySeed("continental", "soup", "Soup", 140, 250, is_junk=False),
    CategorySeed("continental", "salad", "Salad", 200, 360, is_junk=False),
    CategorySeed("continental", "steak", "Steak", 550, 900, is_junk=False),
    CategorySeed("continental", "grilled_seafood", "Grilled Seafood", 380, 650, is_junk=False),
    CategorySeed("continental", "breakfast", "Breakfast", 450, 780, is_junk=False),
    CategorySeed("continental", "dessert", "Dessert", 350, 620, is_junk=True),
    # Two drink categories, not one, and the split is about junk rather than
    # calories. This was a single "Beverage" at 170 to 300 marked junk, with a
    # note saying a black coffee gets clamped up to the floor and that the
    # rounding would not be noticed. The rounding was not the problem: the flag
    # was. A cup of tea logged honestly was junk, and junk ends a streak, so the
    # app had nowhere to record the most ordinary drink in Karachi without
    # either lying about it or losing a run. The sugary half keeps the slug, so
    # every log already filed under it stays where it is and stays junk.
    CategorySeed("continental", "beverage", "Sweet Drink", 170, 300, is_junk=True),
    CategorySeed("continental", "tea_coffee", "Tea and Coffee", 90, 160, is_junk=False),
]

# Starter map pins for Karachi.
#
# Every coordinate below is AREA LEVEL, not a surveyed door position: it is the
# centre of the neighbourhood or strip the restaurant sits on, given to four
# decimal places (about 10m of precision, which is honest for what it is).
# Four places is a deliberate ceiling here, since six would imply a confidence
# about the exact entrance that we do not have. Correct them from the real
# place listing whenever someone has one to hand.
RESTAURANTS: list[RestaurantSeed] = [
    RestaurantSeed("Kolachi", "Do Darya", 24.7866, 67.1487),
    RestaurantSeed("BBQ Tonight", "Boat Basin", 24.8185, 67.0335),
    RestaurantSeed("Cafe Aylanto", "Clifton", 24.8125, 67.0303),
    RestaurantSeed("Xander's", "Zamzama, DHA", 24.8120, 67.0300),
    RestaurantSeed("Kababjees", "Shahrah-e-Faisal", 24.8658, 67.0733),
    RestaurantSeed("Kaybees", "Tariq Road", 24.8730, 67.0630),
    RestaurantSeed("Bundu Khan", "Bahadurabad", 24.8787, 67.0698),
    RestaurantSeed("Hot N Spicy", "Gulshan-e-Iqbal", 24.9215, 67.0958),
    RestaurantSeed("Student Biryani", "Saddar", 24.8618, 67.0295),
    RestaurantSeed("Javed Nihari", "Burns Road", 24.8611, 67.0162),
]

# What a person actually types into the box, lowercase and unpunctuated, one
# list per category. These drive the demo log history, so the mix matters: some
# names carry a word the estimator reads as rich (cream, fried, cheese, butter,
# malai, loaded, mayo) and some carry a light one (grilled, steamed, boiled,
# tandoori, clear, lemon, veg), which is what spreads the demo calories out
# instead of stacking every log on its category midpoint.
DISH_NAMES: dict[str, list[str]] = {
    "biryani": [
        "chicken biryani",
        "beef biryani",
        "sindhi biryani",
        "veg biryani",
        "hyderabadi biryani",
    ],
    "karahi": [
        "chicken karahi",
        "mutton karahi",
        "butter chicken karahi",
        "chicken white karahi",
        "shinwari karahi",
    ],
    "nihari": [
        "beef nihari",
        "mutton nihari",
        "nalli nihari",
        "chicken nihari",
        "maghaz nihari",
    ],
    "haleem": [
        "beef haleem",
        "chicken haleem",
        "daal haleem",
        "veg haleem",
    ],
    "bbq_tikka": [
        "chicken tikka",
        "malai boti",
        "seekh kebab",
        "tandoori chicken",
        "grilled chicken boti",
        "reshmi kebab",
    ],
    "paratha": [
        "plain paratha",
        "aloo paratha",
        "cheese paratha",
        "lachha paratha",
        "stuffed keema paratha",
    ],
    "chaat": [
        "chana chaat",
        "dahi bhalla",
        "fruit chaat",
        "papri chaat",
        "chicken chaat",
    ],
    "daal_chawal": [
        "daal chawal",
        "chana daal with rice",
        "daal maash with rice",
        "boiled rice with masoor daal",
    ],
    "halwa_puri": [
        "halwa puri",
        "puri channa",
        "halwa puri with aloo bhujia",
        "fried puri plate",
    ],
    "samosa_pakora": [
        "chicken samosa",
        "aloo samosa",
        "mixed pakora",
        "veg pakora",
        "fried samosa plate",
    ],
    "burger": [
        "zinger burger",
        "beef cheese burger",
        "double patty burger",
        "grilled chicken burger",
        "loaded smash burger",
    ],
    "fried_chicken": [
        "chicken broast",
        "spicy fried chicken",
        "hot wings",
        "chicken tenders",
        "boneless chicken strips",
    ],
    "sandwich": [
        "club sandwich",
        "grilled chicken sandwich",
        "chicken mayo sandwich",
        "veg sandwich",
        "steak and cheese sandwich",
    ],
    "fries": [
        "regular fries",
        "loaded fries",
        "masala fries",
        "cheese fries",
        "curly fries",
    ],
    "pasta": [
        "chicken alfredo",
        "aglio e olio",
        "penne arrabbiata",
        "creamy pink sauce pasta",
        "grilled chicken pesto pasta",
    ],
    "pizza": [
        "pepperoni pizza",
        "chicken tikka pizza",
        "cheese lovers pizza",
        "stuffed crust pizza",
        "veg supreme pizza",
    ],
    "lasagna": [
        "chicken lasagna",
        "beef lasagna",
        "vegetable lasagna",
        "white sauce lasagna",
    ],
    "fried_rice": [
        "chicken fried rice",
        "egg fried rice",
        "veg fried rice",
        "garlic fried rice",
    ],
    "chow_mein": [
        "chicken chow mein",
        "vegetable chow mein",
        "chilli garlic noodles",
        "hakka noodles",
    ],
    "manchurian": [
        "chicken manchurian",
        "veg manchurian",
        "gobi manchurian",
        "dry fried manchurian",
    ],
    "shawarma": [
        "chicken shawarma",
        "zinger shawarma",
        "cheese shawarma",
        "grilled beef shawarma",
        "shawarma platter with mayo",
    ],
    "hummus_mezze": [
        "hummus with pita",
        "mezze platter",
        "baba ganoush",
        "fattoush salad",
        "labneh with olive oil",
    ],
    "mandi": [
        "chicken mandi",
        "mutton mandi",
        "kabsa rice",
        "grilled mandi platter",
    ],
    "sushi": [
        "california roll",
        "salmon nigiri",
        "spicy tuna roll",
        "crispy fried shrimp roll",
        "veg avocado roll",
    ],
    "ramen": [
        "chicken ramen",
        "tonkotsu ramen",
        "spicy miso ramen",
        "veg ramen",
        "clear broth ramen",
    ],
    "korean_bbq": [
        "bulgogi beef",
        "grilled pork belly",
        "spicy chicken galbi",
        "samgyeopsal",
    ],
    "bibimbap": [
        "beef bibimbap",
        "vegetable bibimbap",
        "dolsot bibimbap",
        "chicken bibimbap",
    ],
    "thai_curry": [
        "thai green curry",
        "red curry with rice",
        "massaman curry",
        "vegetable thai curry",
        "creamy coconut chicken curry",
    ],
    "pad_thai": [
        "chicken pad thai",
        "prawn pad thai",
        "vegetable pad thai",
        "tofu pad thai",
    ],
    "tacos": [
        "chicken tacos",
        "beef tacos",
        "grilled fish tacos",
        "loaded nacho tacos",
        "veg tacos",
    ],
    "burrito": [
        "chicken burrito",
        "beef burrito bowl",
        "cheese burrito",
        "grilled veggie burrito",
    ],
    "soup": [
        "hot and sour soup",
        "chicken corn soup",
        "cream of mushroom soup",
        "clear vegetable soup",
        "thai coconut soup",
    ],
    "salad": [
        "caesar salad",
        "greek salad",
        "russian salad",
        "grilled chicken salad",
        "garden salad",
    ],
    "steak": [
        "grilled tenderloin steak",
        "pepper steak",
        "mushroom cream steak",
        "beef ribeye",
        "chicken steak with white sauce",
    ],
    "grilled_seafood": [
        "grilled fish",
        "fried fish",
        "lemon pepper prawns",
        "steamed fish",
        "prawn masala",
    ],
    "breakfast": [
        "cheese omelette",
        "boiled eggs with toast",
        "french toast",
        "pancakes with syrup",
        "english breakfast platter",
    ],
    "dessert": [
        "chocolate lava cake",
        "cheesecake",
        "gulab jamun",
        "kheer",
        "ice cream sundae",
    ],
    "beverage": [
        "cold coffee",
        "mango shake",
        "lemon iced tea",
        "fresh lime soda",
        "creamy oreo shake",
    ],
    # Centred on chai with milk and sugar, which is what this category is for
    # and what most of it will be. A black or green tea sits under the floor and
    # clamps up to it, overstating by about 80, and that is the same trade the
    # sweet drinks above already make in the other direction. Widening the range
    # to cover both honestly would put it at a 9x spread, which the seed data's
    # own convention caps at 2.5 and test_seed_data.py enforces: a range that
    # wide stops being an estimate.
    "tea_coffee": [
        "doodh patti chai",
        "black tea",
        "green tea",
        "black coffee",
        "cappuccino",
    ],
}

# Rough bounding box for Karachi, used only to catch a transposed or
# sign-flipped coordinate before it becomes a map pin in the Arabian Sea.
_KARACHI_LAT = (24.70, 25.15)
_KARACHI_LON = (66.85, 67.35)


def validate() -> None:
    """Assert the invariants the database would otherwise catch at seed time.

    Nothing calls this at import time on purpose: importing seed data must stay
    free. The test suite calls it, so a bad slug fails in the test suite rather than
    halfway through a migration.
    """
    cuisine_slugs: set[str] = set()
    sort_orders: set[int] = set()
    for cuisine in CUISINES:
        assert _SLUG_RE.match(cuisine.slug), f"bad cuisine slug: {cuisine.slug!r}"
        assert cuisine.slug not in cuisine_slugs, f"duplicate cuisine slug: {cuisine.slug!r}"
        assert cuisine.sort_order not in sort_orders, f"duplicate sort_order: {cuisine.sort_order}"
        assert cuisine.name, f"cuisine {cuisine.slug!r} has no name"
        assert cuisine.emoji, f"cuisine {cuisine.slug!r} has no emoji"
        cuisine_slugs.add(cuisine.slug)
        sort_orders.add(cuisine.sort_order)

    category_slugs: set[str] = set()
    used_cuisines: set[str] = set()
    for category in FOOD_CATEGORIES:
        assert _SLUG_RE.match(category.slug), f"bad category slug: {category.slug!r}"
        assert category.slug not in category_slugs, f"duplicate category slug: {category.slug!r}"
        assert category.cuisine_slug in cuisine_slugs, (
            f"category {category.slug!r} points at unknown cuisine {category.cuisine_slug!r}"
        )
        # Mirrors the calorie_range check constraint on food_categories.
        assert 0 < category.base_calorie_min <= category.base_calorie_max, (
            f"bad calorie range on {category.slug!r}: "
            f"{category.base_calorie_min}, {category.base_calorie_max}"
        )
        category_slugs.add(category.slug)
        used_cuisines.add(category.cuisine_slug)

    orphans = cuisine_slugs - used_cuisines
    assert not orphans, f"cuisines with no categories: {sorted(orphans)}"

    for slug, names in DISH_NAMES.items():
        assert slug in category_slugs, f"dish names for unknown category: {slug!r}"
        assert 3 <= len(names) <= 6, f"category {slug!r} needs 3 to 6 dish names, got {len(names)}"
        assert len(set(names)) == len(names), f"duplicate dish name in {slug!r}"
        assert all(name == name.lower().strip() and name for name in names), (
            f"dish names for {slug!r} must be lowercase and trimmed"
        )

    missing = category_slugs - set(DISH_NAMES)
    assert not missing, f"categories with no dish names: {sorted(missing)}"

    restaurant_keys: set[tuple[str, str]] = set()
    for restaurant in RESTAURANTS:
        key = (restaurant.name.lower(), restaurant.area.lower())
        assert key not in restaurant_keys, f"duplicate restaurant: {restaurant.name!r}"
        assert _KARACHI_LAT[0] <= restaurant.latitude <= _KARACHI_LAT[1], (
            f"{restaurant.name!r} latitude is outside Karachi"
        )
        assert _KARACHI_LON[0] <= restaurant.longitude <= _KARACHI_LON[1], (
            f"{restaurant.name!r} longitude is outside Karachi"
        )
        restaurant_keys.add(key)
