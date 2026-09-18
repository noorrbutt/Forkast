"""Photos on meals.

A text only food log reads like a spreadsheet. The picture is what makes it a
diary, so this is a small feature with an outsized effect, and most of the ways
it goes wrong are about what gets accepted and who can see it.
"""

from __future__ import annotations

import base64

from httpx import AsyncClient

from app.models import MAX_PHOTO_BYTES

LOGS = "/api/v1/logs"

# A real 1x1 PNG, not a prefix with padding, so the signature check is being
# asked about a file that genuinely is one.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000") + b"\x00" * 64
WEBP = bytes.fromhex("52494646") + b"\x00\x00\x00\x00" + bytes.fromhex("57454250") + b"\x00" * 32
# Starts with RIFF like a WebP does, and is not an image.
WAV = bytes.fromhex("52494646") + b"\x00\x00\x00\x00" + bytes.fromhex("57415645") + b"\x00" * 32


async def _log(client: AsyncClient, dish: str = "photo meal") -> str:
    categories = {c["slug"]: c for c in (await client.get("/api/v1/categories")).json()}
    response = await client.post(
        LOGS,
        json={
            "dish_name": dish,
            "category_id": categories["biryani"]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _upload(data: bytes, name: str = "meal.png", content_type: str = "image/png") -> dict:
    return {"file": (name, data, content_type)}


async def test_a_photo_can_be_attached_and_read_back(auth_client: AsyncClient) -> None:
    log_id = await _log(auth_client)

    response = await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(PNG))

    assert response.status_code == 200, response.text
    assert response.json()["has_photo"] is True

    fetched = await auth_client.get(f"{LOGS}/{log_id}/photo")
    assert fetched.status_code == 200
    assert fetched.content == PNG
    assert fetched.headers["content-type"].startswith("image/png")


async def test_a_log_says_whether_it_has_one(auth_client: AsyncClient) -> None:
    """The client needs to know whether to ask for the image at all, and it must
    be able to tell from the list without fetching a single byte."""
    log_id = await _log(auth_client)

    listed = (await auth_client.get(LOGS)).json()["items"]
    assert all(item["has_photo"] is False for item in listed)

    await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(PNG))

    listed = (await auth_client.get(LOGS)).json()["items"]
    assert [item["has_photo"] for item in listed if item["id"] == log_id] == [True]


async def test_uploading_twice_replaces_rather_than_stacks(auth_client: AsyncClient) -> None:
    """One photo per meal, so a retry after a dropped connection is safe."""
    log_id = await _log(auth_client)

    await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(PNG))
    await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(JPEG, "meal.jpg", "image/jpeg"))

    fetched = await auth_client.get(f"{LOGS}/{log_id}/photo")
    assert fetched.content == JPEG
    assert fetched.headers["content-type"].startswith("image/jpeg")


async def test_the_declared_type_is_not_trusted(auth_client: AsyncClient) -> None:
    """The header is whatever the client says it is. These bytes are served back
    to a browser later, so the signature is what decides."""
    log_id = await _log(auth_client)

    response = await auth_client.put(
        f"{LOGS}/{log_id}/photo",
        files=_upload(b"<html><script>alert(1)</script></html>", "x.png", "image/png"),
    )

    assert response.status_code == 415


async def test_a_riff_file_that_is_not_a_webp_is_refused(auth_client: AsyncClient) -> None:
    """RIFF alone is any RIFF container, audio included."""
    log_id = await _log(auth_client)

    assert (
        await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(WAV, "a.webp", "image/webp"))
    ).status_code == 415


async def test_a_real_webp_is_accepted(auth_client: AsyncClient) -> None:
    log_id = await _log(auth_client)

    response = await auth_client.put(
        f"{LOGS}/{log_id}/photo", files=_upload(WEBP, "a.webp", "image/webp")
    )

    assert response.status_code == 200, response.text


async def test_an_oversized_photo_is_refused_with_413_not_a_500(
    auth_client: AsyncClient,
) -> None:
    """The CHECK constraint would also stop this, but as a database error, which
    reaches the user as a 500 and tells them nothing."""
    log_id = await _log(auth_client)
    # Just over our ceiling but still under the server's own 1 MiB request body
    # limit, so this exercises the route's check and its message rather than
    # Starlette rejecting the upload before the route is ever reached.
    too_big = PNG + b"\x00" * (MAX_PHOTO_BYTES + 1 - len(PNG))

    response = await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(too_big))

    assert response.status_code == 413
    assert "KB" in response.json()["detail"], response.text


async def test_an_empty_file_is_refused(auth_client: AsyncClient) -> None:
    log_id = await _log(auth_client)

    assert (await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(b""))).status_code == 422


async def test_a_photo_can_be_removed(auth_client: AsyncClient) -> None:
    log_id = await _log(auth_client)
    await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(PNG))

    assert (await auth_client.delete(f"{LOGS}/{log_id}/photo")).status_code == 204

    assert (await auth_client.get(f"{LOGS}/{log_id}/photo")).status_code == 404
    assert (await auth_client.get(f"{LOGS}/{log_id}")).json()["has_photo"] is False


async def test_removing_a_photo_that_was_never_there_is_not_an_error(
    auth_client: AsyncClient,
) -> None:
    log_id = await _log(auth_client)

    assert (await auth_client.delete(f"{LOGS}/{log_id}/photo")).status_code == 204


async def test_asking_for_a_photo_that_does_not_exist(auth_client: AsyncClient) -> None:
    log_id = await _log(auth_client)

    assert (await auth_client.get(f"{LOGS}/{log_id}/photo")).status_code == 404


async def test_deleting_the_meal_takes_the_photo_with_it(auth_client: AsyncClient) -> None:
    log_id = await _log(auth_client)
    await auth_client.put(f"{LOGS}/{log_id}/photo", files=_upload(PNG))

    assert (await auth_client.delete(f"{LOGS}/{log_id}")).status_code == 204

    assert (await auth_client.get(f"{LOGS}/{log_id}/photo")).status_code == 404


async def test_one_persons_photo_is_not_visible_to_another(client: AsyncClient) -> None:
    """The whole point of the feature is that these are pictures of your life."""
    mine = (
        await client.post(
            "/api/v1/auth/register", json={"email": "p1@forkast.app", "password": "password123"}
        )
    ).json()
    theirs = (
        await client.post(
            "/api/v1/auth/register", json={"email": "p2@forkast.app", "password": "password123"}
        )
    ).json()
    mine_h = {"Authorization": f"Bearer {mine['access_token']}"}
    theirs_h = {"Authorization": f"Bearer {theirs['access_token']}"}

    categories = {
        c["slug"]: c for c in (await client.get("/api/v1/categories", headers=mine_h)).json()
    }
    created = await client.post(
        LOGS,
        headers=mine_h,
        json={
            "dish_name": "private lunch",
            "category_id": categories["biryani"]["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    log_id = created.json()["id"]
    await client.put(f"{LOGS}/{log_id}/photo", headers=mine_h, files=_upload(PNG))

    # 404 rather than 403, so the id is not confirmed to exist.
    assert (await client.get(f"{LOGS}/{log_id}/photo", headers=theirs_h)).status_code == 404
    assert (
        await client.put(f"{LOGS}/{log_id}/photo", headers=theirs_h, files=_upload(JPEG))
    ).status_code == 404
    assert (await client.delete(f"{LOGS}/{log_id}/photo", headers=theirs_h)).status_code == 404
    # And mine is untouched by any of that.
    assert (await client.get(f"{LOGS}/{log_id}/photo", headers=mine_h)).content == PNG


async def test_photo_routes_need_authentication(client: AsyncClient) -> None:
    fake = "01a00000-0000-7000-8000-000000000000"
    assert (await client.get(f"{LOGS}/{fake}/photo")).status_code == 401
    assert (await client.delete(f"{LOGS}/{fake}/photo")).status_code == 401
