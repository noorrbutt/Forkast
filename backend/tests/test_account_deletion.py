"""Deleting an account, and what survives it.

Play requires any app with account creation to offer deletion in the app, and
it is the right thing regardless: everything a person logged here is a record of
what they ate, which is not data to hold onto after they ask you not to.
"""

from __future__ import annotations

from httpx import AsyncClient

ME = "/api/v1/me"
EXPORT = "/api/v1/me/export"


async def _eat(client: AsyncClient) -> None:
    categories = {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}
    response = await client.post(
        "/api/v1/logs",
        json={
            "dish_name": "goodbye biryani",
            "category_id": categories["biryani"]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 201, response.text


async def test_export_is_json_or_csv_and_only_contains_the_callers_data(
    client: AsyncClient,
) -> None:
    first = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "First",
                "last_name": "User",
                "email": "export-first@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Second",
                "last_name": "User",
                "email": "export-second@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    first_headers = {"Authorization": f"Bearer {first['access_token']}"}
    second_headers = {"Authorization": f"Bearer {second['access_token']}"}

    categories = {
        c["slug"]: c for c in (await client.get("/api/v1/categories", headers=first_headers)).json()
    }
    await client.post(
        "/api/v1/logs",
        headers=first_headers,
        json={
            "dish_name": "first meal",
            "category_id": categories["biryani"]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    await client.post(
        "/api/v1/logs",
        headers=second_headers,
        json={
            "dish_name": "second meal",
            "category_id": categories["fries"]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    await client.put("/api/v1/burn", headers=first_headers, json={"calories": 200})
    await client.put("/api/v1/burn", headers=second_headers, json={"calories": 300})

    json_response = await client.get(EXPORT, headers=first_headers)
    assert json_response.status_code == 200
    assert json_response.headers["content-disposition"].endswith('.json"')
    exported = json_response.json()
    assert [log["dish_name"] for log in exported["food_logs"]] == ["first meal"]
    assert [log["calories"] for log in exported["burn_logs"]] == [200]
    assert "second meal" not in json_response.text

    csv_response = await client.get(EXPORT, headers=first_headers, params={"format": "csv"})
    assert csv_response.status_code == 200
    assert csv_response.headers["content-type"].startswith("text/csv")
    assert csv_response.headers["content-disposition"].endswith('.csv"')
    assert "first meal" in csv_response.text
    assert "second meal" not in csv_response.text
    assert "burn_logs" in csv_response.text


async def test_the_account_and_its_data_go(auth_client: AsyncClient) -> None:
    await _eat(auth_client)
    await auth_client.put("/api/v1/burn", json={"calories": 200})

    response = await auth_client.request("DELETE", ME, json={"password": "password123"})

    assert response.status_code == 204, response.text
    # The token is still syntactically valid; the account behind it is not.
    assert (await auth_client.get(ME)).status_code == 401


async def test_the_wrong_password_deletes_nothing(auth_client: AsyncClient) -> None:
    """A phone left unlocked on a table is the realistic threat here."""
    await _eat(auth_client)

    response = await auth_client.request("DELETE", ME, json={"password": "not-the-password"})

    assert response.status_code == 403
    assert (await auth_client.get(ME)).status_code == 200
    assert (await auth_client.get("/api/v1/logs")).json()["items"]


async def test_deleting_needs_a_password_at_all(auth_client: AsyncClient) -> None:
    assert (await auth_client.request("DELETE", ME, json={})).status_code == 422


async def test_deleting_needs_authentication(client: AsyncClient) -> None:
    assert (await client.request("DELETE", ME, json={"password": "x"})).status_code == 401


async def test_every_session_ends_not_just_this_one(client: AsyncClient) -> None:
    """Refresh tokens cascade, so a second signed in device cannot carry on."""
    registered = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "two-devices@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    second = (
        await client.post(
            "/api/v1/auth/login",
            json={"email": "two-devices@forkast.app", "password": "password123"},
        )
    ).json()
    first_headers = {"Authorization": f"Bearer {registered['access_token']}"}

    assert (
        await client.request("DELETE", ME, headers=first_headers, json={"password": "password123"})
    ).status_code == 204

    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": second["refresh_token"]}
    )
    assert refreshed.status_code == 401, "the other device could still get a new token"


async def test_a_shared_restaurant_outlives_the_person_who_added_it(
    client: AsyncClient,
) -> None:
    """created_by is SET NULL rather than CASCADE on purpose. The registry is
    keyed on name and area and other people log against it, so closing one
    account must not delete a place out from under everyone else."""
    mine = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "adder@forkast.app",
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
                "email": "diner@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    mine_h = {"Authorization": f"Bearer {mine['access_token']}"}
    theirs_h = {"Authorization": f"Bearer {theirs['access_token']}"}

    created = await client.post(
        "/api/v1/restaurants", headers=mine_h, json={"name": "Ghar Ka Khana", "area": "DHA"}
    )
    assert created.status_code in (200, 201), created.text

    assert (
        await client.request("DELETE", ME, headers=mine_h, json={"password": "password123"})
    ).status_code == 204

    still_there = await client.get("/api/v1/restaurants", headers=theirs_h, params={"q": "Ghar"})
    assert any(r["name"] == "Ghar Ka Khana" for r in still_there.json())
