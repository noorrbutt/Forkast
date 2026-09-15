"""Cuisines, categories, fuzzy search and the restaurant registry."""

from __future__ import annotations

from httpx import AsyncClient


async def test_cuisines_are_returned_in_display_order(auth_client: AsyncClient) -> None:
    cuisines = (await auth_client.get("/api/v1/cuisines")).json()

    assert len(cuisines) >= 8
    assert [c["sort_order"] for c in cuisines] == sorted(c["sort_order"] for c in cuisines)
    # Desi sorts first: it is what this app's users log most days.
    assert cuisines[0]["slug"] == "desi"


async def test_categories_can_be_filtered_by_cuisine(auth_client: AsyncClient) -> None:
    cuisines = (await auth_client.get("/api/v1/cuisines")).json()
    desi = next(c for c in cuisines if c["slug"] == "desi")

    filtered = (
        await auth_client.get("/api/v1/categories", params={"cuisine_id": desi["id"]})
    ).json()
    everything = (await auth_client.get("/api/v1/categories")).json()

    assert len(filtered) > 0
    assert len(filtered) < len(everything)
    assert all(c["cuisine_id"] == desi["id"] for c in filtered)


async def test_every_category_has_a_sane_calorie_range(auth_client: AsyncClient) -> None:
    for category in (await auth_client.get("/api/v1/categories")).json():
        assert 0 < category["base_calorie_min"] <= category["base_calorie_max"], category["slug"]


async def test_search_finds_a_category_by_exact_fragment(auth_client: AsyncClient) -> None:
    results = (await auth_client.get("/api/v1/search", params={"q": "biry"})).json()

    assert any(c["slug"] == "biryani" for c in results["categories"])


async def test_search_survives_a_misspelling(auth_client: AsyncClient) -> None:
    """This is the reason pg_trgm is in the schema at all."""
    results = (await auth_client.get("/api/v1/search", params={"q": "biriani"})).json()

    assert any(c["slug"] == "biryani" for c in results["categories"])


async def test_search_matches_a_cuisine_by_origin(auth_client: AsyncClient) -> None:
    results = (await auth_client.get("/api/v1/search", params={"q": "italian"})).json()

    assert any(c["slug"] == "italian" for c in results["cuisines"])


async def test_search_returns_the_callers_own_dishes_only(client: AsyncClient) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register", json={"email": "diner@forkast.app", "password": "password123"}
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register", json={"email": "other@forkast.app", "password": "password123"}
        )
    ).json()
    mine = {"Authorization": f"Bearer {first['access_token']}"}
    theirs = {"Authorization": f"Bearer {second['access_token']}"}

    categories = (await client.get("/api/v1/categories", headers=mine)).json()
    await client.post(
        "/api/v1/logs",
        headers=mine,
        json={
            "dish_name": "sindhi biryani double plate",
            "category_id": next(c for c in categories if c["slug"] == "biryani")["id"],
            "rating": 5,
            "serving_size": "large",
        },
    )

    ours = (await client.get("/api/v1/search", headers=mine, params={"q": "sindhi"})).json()
    other = (await client.get("/api/v1/search", headers=theirs, params={"q": "sindhi"})).json()

    assert any(d["dish_name"] == "sindhi biryani double plate" for d in ours["dishes"])
    assert other["dishes"] == []


async def test_search_for_nonsense_returns_empty_lists_not_an_error(
    auth_client: AsyncClient,
) -> None:
    results = (await auth_client.get("/api/v1/search", params={"q": "zzzqqqxxx"})).json()

    assert results["categories"] == []
    assert results["cuisines"] == []
    assert results["dishes"] == []


async def test_creating_the_same_restaurant_twice_returns_one_row(
    auth_client: AsyncClient,
) -> None:
    first = await auth_client.post(
        "/api/v1/restaurants", json={"name": "Kolachi", "area": "Do Darya"}
    )
    second = await auth_client.post(
        "/api/v1/restaurants", json={"name": "  kolachi", "area": "DO DARYA"}
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_the_same_name_in_a_different_area_is_a_different_restaurant(
    auth_client: AsyncClient,
) -> None:
    first = await auth_client.post(
        "/api/v1/restaurants", json={"name": "Kababjees", "area": "Shahrah-e-Faisal"}
    )
    second = await auth_client.post(
        "/api/v1/restaurants", json={"name": "Kababjees", "area": "Clifton"}
    )

    assert first.json()["id"] != second.json()["id"]


async def test_restaurant_coordinates_are_optional(auth_client: AsyncClient) -> None:
    response = await auth_client.post("/api/v1/restaurants", json={"name": "Somewhere New"})

    assert response.status_code == 201
    body = response.json()
    assert body["latitude"] is None
    assert body["longitude"] is None


async def test_restaurants_can_be_searched_by_name(auth_client: AsyncClient) -> None:
    await auth_client.post("/api/v1/restaurants", json={"name": "BBQ Tonight", "area": "Boat Basin"})

    results = (await auth_client.get("/api/v1/restaurants", params={"q": "bbq"})).json()

    assert any(r["name"] == "BBQ Tonight" for r in results)
