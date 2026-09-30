"""A log priced from a photo estimate, rather than re-priced from its category.

The confirm screen shows a number and macros a vision model answered for the
actual photo. Before this, POST /logs always discarded that and re-priced from
the category midpoint instead, so the figure someone approved was never the
figure that landed on their diary entry. estimated_calories (+ protein_g,
carbs_g, fat_g) is what lets the client send the approved figure through.
"""

from __future__ import annotations

from httpx import AsyncClient

LOGS = "/api/v1/logs"


async def _a_category(client: AsyncClient, slug: str = "biryani") -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    return next(c for c in categories if c["slug"] == slug)


def _payload(category: dict, **overrides) -> dict:
    payload = {
        "dish_name": "chicken biryani",
        "category_id": category["id"],
        "rating": 4,
        "serving_size": "medium",
    }
    payload.update(overrides)
    return payload


async def test_a_photo_estimate_is_stored_exactly_as_sent_within_bounds(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    # Comfortably inside the widened photo bound but well outside the
    # category's own [base_min, base_max] range, so this also proves the
    # figure was not silently re-clamped to the category range the way a
    # category-priced log would be.
    photo_calories = category["base_calorie_max"] * 1.8

    response = await auth_client.post(
        LOGS,
        json=_payload(
            category,
            estimated_calories=photo_calories,
            protein_g=32.5,
            carbs_g=64.0,
            fat_g=18.3,
        ),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["estimated_calories"] == round(photo_calories)
    assert body["calorie_source"] == "photo"
    assert body["protein_g"] == 32.5
    assert body["carbs_g"] == 64.0
    # The column is Numeric(6, 1) -- one decimal place, matching what a
    # macro figure actually needs precision for.
    assert body["fat_g"] == 18.3
    # Already the model's own answer for this photo, not a provisional figure
    # waiting on a background call.
    assert body["refined"] is True


async def test_a_category_priced_log_is_unaffected(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(LOGS, json=_payload(category))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["calorie_source"] == "category"
    assert body["protein_g"] is None
    assert body["carbs_g"] is None
    assert body["fat_g"] is None
    # Provisional: refined only once the background call lands.
    assert body["refined"] is False


async def test_a_wildly_high_photo_estimate_is_clamped_not_trusted(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(LOGS, json=_payload(category, estimated_calories=19_999))

    assert response.status_code == 201, response.text
    stored = response.json()["estimated_calories"]
    assert stored < 19_999
    # Still generous -- three times the category max -- not squeezed back to
    # the category's own nominal range the way a category-priced log would be.
    assert stored <= category["base_calorie_max"] * 3


async def test_a_wildly_low_photo_estimate_is_clamped_not_trusted(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(LOGS, json=_payload(category, estimated_calories=1))

    assert response.status_code == 201, response.text
    assert response.json()["estimated_calories"] >= 50


async def test_macros_without_a_calorie_figure_are_rejected(auth_client: AsyncClient) -> None:
    category = await _a_category(auth_client)

    response = await auth_client.post(LOGS, json=_payload(category, protein_g=20))

    assert response.status_code == 422


async def test_repeating_a_photo_priced_log_carries_its_provenance_and_macros(
    auth_client: AsyncClient,
) -> None:
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json=_payload(category, estimated_calories=700, protein_g=30, carbs_g=50, fat_g=15),
        )
    ).json()

    repeated = await auth_client.post(f"{LOGS}/{created['id']}/repeat")

    assert repeated.status_code == 201, repeated.text
    body = repeated.json()
    assert body["estimated_calories"] == created["estimated_calories"]
    assert body["calorie_source"] == "photo"
    assert body["protein_g"] == 30
    assert body["carbs_g"] == 50
    assert body["fat_g"] == 15
    assert body["refined"] is True


async def test_editing_the_category_of_a_photo_priced_log_re_prices_it_from_scratch(
    auth_client: AsyncClient,
) -> None:
    """The photo described a specific dish in a specific category. Moving it
    to a different category invalidates that description -- the figure
    becomes a fresh category-derived guess, not the number the photo
    answered, and the macros were for the old dish."""
    biryani = await _a_category(auth_client, "biryani")
    fries = await _a_category(auth_client, "fries")

    created = (
        await auth_client.post(
            LOGS,
            json=_payload(biryani, estimated_calories=900, protein_g=40, carbs_g=80, fat_g=20),
        )
    ).json()
    assert created["calorie_source"] == "photo"

    updated = await auth_client.patch(f"{LOGS}/{created['id']}", json={"category_id": fries["id"]})

    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["calorie_source"] == "category"
    assert body["protein_g"] is None
    assert body["carbs_g"] is None
    assert body["fat_g"] is None
    assert body["refined"] is False
