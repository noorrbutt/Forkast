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
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "diner@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "other@forkast.app",
                "password": "password123",
            },
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

    assert first.status_code == 201, "the first call genuinely creates the row"
    assert second.status_code == 200, "a deduped call is a lookup, not a creation"
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
    await auth_client.post(
        "/api/v1/restaurants", json={"name": "BBQ Tonight", "area": "Boat Basin"}
    )

    results = (await auth_client.get("/api/v1/restaurants", params={"q": "bbq"})).json()

    assert any(r["name"] == "BBQ Tonight" for r in results)


async def test_a_blank_search_query_is_rejected(auth_client: AsyncClient) -> None:
    """A whitespace-only query used to match every row, because the length check
    ran against the unstripped string."""
    assert (await auth_client.get("/api/v1/search", params={"q": "   "})).status_code == 422


async def test_search_survives_hostile_input(auth_client: AsyncClient) -> None:
    """The LIKE pattern is interpolated, so confirm it is parameterised."""
    for query in ["%", "_", "'", "100%' OR '1'='1", "\\", "a'--"]:
        response = await auth_client.get("/api/v1/search", params={"q": query})
        assert response.status_code == 200, f"{query!r} returned {response.status_code}"


async def test_coordinates_are_json_numbers_not_strings(auth_client: AsyncClient) -> None:
    """The column is Numeric, which pydantic would serialise as a string.

    A map cannot use a string, and the mismatch is invisible until someone plots
    a pin, so it is pinned down here.
    """
    created = await auth_client.post(
        "/api/v1/restaurants",
        json={
            "name": "Coordinate Probe",
            "area": "Clifton",
            "latitude": 24.8185,
            "longitude": 67.0335,
        },
    )

    body = created.json()
    assert isinstance(body["latitude"], float), f"got {type(body['latitude']).__name__}"
    assert isinstance(body["longitude"], float), f"got {type(body['longitude']).__name__}"
    assert abs(body["latitude"] - 24.8185) < 0.0001


async def test_both_cuisine_parameter_spellings_filter(auth_client: AsyncClient) -> None:
    """The clients send cuisine_id, the project plan's route table wrote
    ?cuisine=. Both have to filter, or a caller following one of them silently
    receives every category instead of an error."""
    cuisines = (await auth_client.get("/api/v1/cuisines")).json()
    desi = next(c for c in cuisines if c["slug"] == "desi")
    everything = (await auth_client.get("/api/v1/categories")).json()

    by_id = (await auth_client.get("/api/v1/categories", params={"cuisine_id": desi["id"]})).json()
    by_plan_spelling = (
        await auth_client.get("/api/v1/categories", params={"cuisine": desi["id"]})
    ).json()

    assert 0 < len(by_id) < len(everything)
    assert len(by_plan_spelling) == len(by_id)
    assert {c["id"] for c in by_plan_spelling} == {c["id"] for c in by_id}


async def test_a_nul_byte_in_a_search_term_is_a_client_error(auth_client: AsyncClient) -> None:
    """The term reaches PostgreSQL as an ILIKE pattern and a trigram operand,
    and \x00 in either one used to surface as a 500."""
    assert (await auth_client.get("/api/v1/search", params={"q": "bir\x00yani"})).status_code == 422
    assert (
        await auth_client.get("/api/v1/restaurants", params={"q": "kol\x00achi"})
    ).status_code == 422


async def test_a_blank_restaurant_query_lists_rather_than_matching_everything(
    auth_client: AsyncClient,
) -> None:
    """ "?q=   " used to build an empty LIKE pattern that matched every row
    through the slow path instead of just listing."""
    await auth_client.post("/api/v1/restaurants", json={"name": "Kolachi", "area": "Do Darya"})

    blank = await auth_client.get("/api/v1/restaurants", params={"q": "   "})
    listed = await auth_client.get("/api/v1/restaurants")

    assert blank.status_code == 200
    assert blank.json() == listed.json()


async def test_a_whitespace_only_restaurant_name_is_rejected(auth_client: AsyncClient) -> None:
    response = await auth_client.post("/api/v1/restaurants", json={"name": "   "})

    assert response.status_code == 422


async def test_a_nul_byte_in_a_restaurant_name_is_a_client_error(
    auth_client: AsyncClient,
) -> None:
    response = await auth_client.post("/api/v1/restaurants", json={"name": "Kol\x00achi"})

    assert response.status_code == 422


async def test_the_restaurant_list_is_shared_by_default(client: AsyncClient) -> None:
    """The registry is deliberately shared: the autocomplete on the log screen
    is what stops one place being typed in five slightly different ways."""
    mine = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "r1@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    theirs = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "r2@forkast.app",
                "password": "password123",
            },
        )
    ).json()

    await client.post(
        "/api/v1/restaurants",
        headers={"Authorization": f"Bearer {theirs['access_token']}"},
        json={"name": "Someone Elses Place", "area": "Clifton"},
    )

    listed = await client.get(
        "/api/v1/restaurants", headers={"Authorization": f"Bearer {mine['access_token']}"}
    )

    assert "Someone Elses Place" in [r["name"] for r in listed.json()]


async def test_mine_narrows_the_list_to_places_this_user_has_eaten_at(
    client: AsyncClient,
) -> None:
    """The map is a personal food heatmap. Listing the whole registry there
    pinned places the user had never been and showed them which restaurants
    other people had been adding."""
    mine = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "m1@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    theirs = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "m2@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    categories = (
        await client.get(
            "/api/v1/categories", headers={"Authorization": f"Bearer {mine['access_token']}"}
        )
    ).json()

    await client.post(
        "/api/v1/logs",
        headers={"Authorization": f"Bearer {theirs['access_token']}"},
        json={
            "dish_name": "their dinner",
            "category_id": categories[0]["id"],
            "rating": 4,
            "serving_size": "medium",
            "restaurant_name": "Their Local",
        },
    )
    await client.post(
        "/api/v1/logs",
        headers={"Authorization": f"Bearer {mine['access_token']}"},
        json={
            "dish_name": "my dinner",
            "category_id": categories[0]["id"],
            "rating": 4,
            "serving_size": "medium",
            "restaurant_name": "My Local",
        },
    )

    visited = await client.get(
        "/api/v1/restaurants",
        headers={"Authorization": f"Bearer {mine['access_token']}"},
        params={"mine": True},
    )

    assert [r["name"] for r in visited.json()] == ["My Local"]


async def test_mine_returns_a_restaurant_once_however_often_it_was_visited(
    auth_client: AsyncClient,
) -> None:
    """An EXISTS rather than a join, or a favourite place would be pinned once
    per visit."""
    categories = (await auth_client.get("/api/v1/categories")).json()
    for _ in range(3):
        await auth_client.post(
            "/api/v1/logs",
            json={
                "dish_name": "the usual",
                "category_id": categories[0]["id"],
                "rating": 5,
                "serving_size": "medium",
                "restaurant_name": "Kolachi",
            },
        )

    visited = (await auth_client.get("/api/v1/restaurants", params={"mine": True})).json()

    assert [r["name"] for r in visited] == ["Kolachi"]
