"""Profile pictures.

A picture on an account is a small feature, and almost everything that can go
wrong with it is about what gets accepted and who can see it, so that is what
these are about.
"""

from __future__ import annotations

import base64

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MAX_AVATAR_BYTES

ME = "/api/v1/me"
AVATAR = "/api/v1/me/avatar"
REGISTER = "/api/v1/auth/register"

# A real 1x1 PNG, not a prefix with padding, so the signature check is being
# asked about a file that genuinely is one.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000") + b"\x00" * 64
WEBP = bytes.fromhex("52494646") + b"\x00\x00\x00\x00" + bytes.fromhex("57454250") + b"\x00" * 32
# Starts with RIFF like a WebP does, and is not an image.
WAV = bytes.fromhex("52494646") + b"\x00\x00\x00\x00" + bytes.fromhex("57415645") + b"\x00" * 32


def _upload(data: bytes, name: str = "me.png", content_type: str = "image/png") -> dict:
    return {"file": (name, data, content_type)}


async def _register(client: AsyncClient, email: str) -> dict:
    response = await client.post(
        REGISTER,
        json={"first_name": "Test", "last_name": "User", "email": email, "password": "password123"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def test_a_picture_can_be_uploaded_and_read_back(auth_client: AsyncClient) -> None:
    response = await auth_client.put(AVATAR, files=_upload(PNG))

    assert response.status_code == 200, response.text
    assert response.json()["has_avatar"] is True

    fetched = await auth_client.get(AVATAR)
    assert fetched.status_code == 200
    assert fetched.content == PNG
    assert fetched.headers["content-type"].startswith("image/png")


async def test_the_profile_says_whether_there_is_one(auth_client: AsyncClient) -> None:
    """The client needs to know whether to ask for the image at all, and it must
    be able to tell without fetching a single byte."""
    assert (await auth_client.get(ME)).json()["has_avatar"] is False

    await auth_client.put(AVATAR, files=_upload(PNG))

    assert (await auth_client.get(ME)).json()["has_avatar"] is True
    assert (await auth_client.get("/api/v1/me")).json()["has_avatar"] is True


async def test_uploading_twice_replaces_rather_than_stacks(auth_client: AsyncClient) -> None:
    """One picture per account, so a retry after a dropped connection is safe."""
    await auth_client.put(AVATAR, files=_upload(PNG))
    await auth_client.put(AVATAR, files=_upload(JPEG, "me.jpg", "image/jpeg"))

    fetched = await auth_client.get(AVATAR)
    assert fetched.content == JPEG
    assert fetched.headers["content-type"].startswith("image/jpeg")


async def test_the_declared_type_is_not_trusted(auth_client: AsyncClient) -> None:
    """The header is whatever the client says it is, and these bytes are served
    back with a content type of their own later."""
    response = await auth_client.put(
        AVATAR, files=_upload(b"<html><script>alert(1)</script></html>", "x.png", "image/png")
    )

    assert response.status_code == 415
    assert (await auth_client.get(ME)).json()["has_avatar"] is False


async def test_a_riff_file_that_is_not_a_webp_is_refused(auth_client: AsyncClient) -> None:
    """RIFF alone is any RIFF container, audio included."""
    response = await auth_client.put(AVATAR, files=_upload(WAV, "a.webp", "image/webp"))

    assert response.status_code == 415


async def test_a_real_webp_is_accepted(auth_client: AsyncClient) -> None:
    response = await auth_client.put(AVATAR, files=_upload(WEBP, "a.webp", "image/webp"))

    assert response.status_code == 200, response.text


async def test_an_oversized_picture_is_refused_with_413_not_a_500(
    auth_client: AsyncClient,
) -> None:
    """The CHECK constraint would also stop this, but as a database error, which
    reaches the user as a 500 and tells them nothing."""
    # Just over our ceiling and still under the server's own 1 MiB request body
    # limit, so this exercises the route's check and its message rather than
    # Starlette rejecting the upload before the route is ever reached.
    too_big = PNG + b"\x00" * (MAX_AVATAR_BYTES + 1 - len(PNG))

    response = await auth_client.put(AVATAR, files=_upload(too_big))

    assert response.status_code == 413
    assert "KB" in response.json()["detail"], response.text
    assert (await auth_client.get(AVATAR)).status_code == 404


async def test_an_empty_file_is_refused(auth_client: AsyncClient) -> None:
    assert (await auth_client.put(AVATAR, files=_upload(b""))).status_code == 422


async def test_a_picture_can_be_removed(auth_client: AsyncClient) -> None:
    await auth_client.put(AVATAR, files=_upload(PNG))

    assert (await auth_client.delete(AVATAR)).status_code == 204

    assert (await auth_client.get(AVATAR)).status_code == 404
    assert (await auth_client.get(ME)).json()["has_avatar"] is False


async def test_removing_a_picture_that_was_never_there_is_not_an_error(
    auth_client: AsyncClient,
) -> None:
    assert (await auth_client.delete(AVATAR)).status_code == 204


async def test_asking_for_a_picture_that_is_not_there(auth_client: AsyncClient) -> None:
    assert (await auth_client.get(AVATAR)).status_code == 404


async def test_one_persons_picture_is_not_reachable_by_another(client: AsyncClient) -> None:
    """An avatar is only ever addressable as your own, so there is no id for
    somebody else to ask for."""
    mine = await _register(client, "face1@forkast.app")
    theirs = await _register(client, "face2@forkast.app")

    await client.put(AVATAR, headers=mine, files=_upload(PNG))

    assert (await client.get(AVATAR, headers=theirs)).status_code == 404
    assert (await client.get(ME, headers=theirs)).json()["has_avatar"] is False

    # Their own upload, and their own delete, leave mine exactly where it was.
    await client.put(AVATAR, headers=theirs, files=_upload(JPEG, "me.jpg", "image/jpeg"))
    assert (await client.delete(AVATAR, headers=theirs)).status_code == 204

    assert (await client.get(AVATAR, headers=mine)).content == PNG


async def test_closing_the_account_takes_the_picture_with_it(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The bytes are the most personal thing stored here, so the cascade that
    removes them is worth asserting rather than assuming."""
    mine = await _register(client, "leaving@forkast.app")
    await client.put(AVATAR, headers=mine, files=_upload(PNG))

    assert await session.scalar(text("SELECT count(*) FROM user_avatars")) == 1

    assert (
        await client.request("DELETE", ME, headers=mine, json={"password": "password123"})
    ).status_code == 204

    assert await session.scalar(text("SELECT count(*) FROM user_avatars")) == 0


async def test_avatar_routes_need_authentication(client: AsyncClient) -> None:
    assert (await client.get(AVATAR)).status_code == 401
    assert (await client.put(AVATAR, files=_upload(PNG))).status_code == 401
    assert (await client.delete(AVATAR)).status_code == 401
