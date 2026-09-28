"""POST /logs/estimate-photo: the route itself, not the AI seam behind it.

Runs entirely against the fake provider (the test suite's default, see
conftest's AI_PROVIDER=fake note), so these exercise upload validation, the
response shape, and failure handling without a network call. Rate limiting,
the kill switch and image compression -- all gated on AI_PROVIDER=groq -- are
covered separately in test_photo_estimation_limits.py.
"""

from __future__ import annotations

import base64

from httpx import AsyncClient

ESTIMATE = "/api/v1/logs/estimate-photo"

# A real 1x1 PNG, decodable by Pillow, not just a signature that satisfies
# _sniff -- matches the one test_photos.py uses.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000") + b"\x00" * 64
WEBP = bytes.fromhex("52494646") + b"\x00\x00\x00\x00" + bytes.fromhex("57454250") + b"\x00" * 32
# Starts with RIFF like a WebP does, and is not an image.
WAV = bytes.fromhex("52494646") + b"\x00\x00\x00\x00" + bytes.fromhex("57415645") + b"\x00" * 32


def _upload(data: bytes, name: str = "meal.png", content_type: str = "image/png") -> dict:
    return {"file": (name, data, content_type)}


async def test_a_photo_returns_an_estimate_without_creating_a_log(
    auth_client: AsyncClient,
) -> None:
    before = (await auth_client.get("/api/v1/logs")).json()["total"]

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dish_guess"]
    assert body["calories"] > 0
    assert set(body["macros"]) == {"protein_g", "carbs_g", "fat_g"}
    assert body["confidence"] in ("high", "medium", "low")
    # A preview only. Confirming still goes through POST /logs once a category
    # is picked, so nothing here should have written a row.
    assert (await auth_client.get("/api/v1/logs")).json()["total"] == before


async def test_the_declared_content_type_is_not_trusted(auth_client: AsyncClient) -> None:
    response = await auth_client.post(
        ESTIMATE,
        files=_upload(b"<html><script>alert(1)</script></html>", "x.png", "image/png"),
    )

    assert response.status_code == 415


async def test_a_riff_file_that_is_not_a_webp_is_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.post(ESTIMATE, files=_upload(WAV, "a.webp", "image/webp"))

    assert response.status_code == 415


async def test_a_real_jpeg_and_webp_are_both_accepted(auth_client: AsyncClient) -> None:
    jpeg = await auth_client.post(ESTIMATE, files=_upload(JPEG, "meal.jpg", "image/jpeg"))
    webp = await auth_client.post(ESTIMATE, files=_upload(WEBP, "meal.webp", "image/webp"))

    assert jpeg.status_code == 200, jpeg.text
    assert webp.status_code == 200, webp.text


async def test_an_empty_file_is_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.post(ESTIMATE, files=_upload(b""))

    assert response.status_code == 422


async def test_an_oversized_photo_is_refused_with_413_not_a_500(
    auth_client: AsyncClient,
) -> None:
    from app.models import MAX_PHOTO_BYTES

    too_big = PNG + b"\x00" * (MAX_PHOTO_BYTES + 1 - len(PNG))

    response = await auth_client.post(ESTIMATE, files=_upload(too_big))

    assert response.status_code == 413
    assert "KB" in response.json()["detail"], response.text


async def test_the_route_needs_a_token(client: AsyncClient) -> None:
    assert (await client.post(ESTIMATE, files=_upload(PNG))).status_code == 401


async def test_a_dead_ai_provider_is_a_502_not_a_500(auth_client: AsyncClient) -> None:
    """Mirrors test_groq_service.py's equivalent for /plans: the provider is
    upstream of us, so its outage is a 502, and nothing has been persisted."""
    from app.main import app
    from app.services.ai.base import AIService
    from app.services.ai.groq_service import GroqResponseError

    class _AlwaysFailingAI:
        async def adjust_calories(self, req):
            raise NotImplementedError

        async def generate_plan(self, req):
            raise NotImplementedError

        async def estimate_from_photo(self, image, content_type):
            raise GroqResponseError("marker: upstream response text must not leak")

    assert isinstance(_AlwaysFailingAI(), AIService)

    from app.services.ai.deps import get_ai_service

    app.dependency_overrides[get_ai_service] = lambda: _AlwaysFailingAI()
    try:
        response = await auth_client.post(ESTIMATE, files=_upload(PNG))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 502, response.text
    assert response.json()["detail"] == "The photo estimator is unavailable."
    assert "marker: upstream response text must not leak" not in response.text


async def test_one_users_photo_does_not_touch_another_accounts_logs(client: AsyncClient) -> None:
    """Nothing is saved by this route for anyone, but the account boundary is
    worth pinning down the same way every other route earns a test for it."""
    first = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "first_name": "Test",
                "last_name": "User",
                "email": "photo1@forkast.app",
                "password": "password123",
            },
        )
    ).json()
    headers = {"Authorization": f"Bearer {first['access_token']}"}

    response = await client.post(ESTIMATE, headers=headers, files=_upload(PNG))

    assert response.status_code == 200, response.text
    assert (await client.get("/api/v1/logs", headers=headers)).json()["total"] == 0
