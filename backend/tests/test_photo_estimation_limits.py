"""Rate limiting, the kill switch and server-side downscaling for
POST /logs/estimate-photo -- everything in the route that only matters once a
real, billable vision call is behind it.

All three are gated on estimate_source == "ai" rather than on
settings.ai_provider directly (see the route's own docstring for why), which
means the test suite's default -- every test runs against the deterministic
fake, per conftest's autouse deterministic_ai fixture -- has to be overridden
on purpose here to exercise them, exactly the way test_groq_service.py
overrides get_ai_service to exercise a failure path the fake never produces.
Overriding get_estimate_source to "ai" while leaving get_ai_service as the
fake (deterministic_ai's default) is what lets these tests drive the real
rate-limit and compression code without ever making a network call.
"""

from __future__ import annotations

import base64
import io

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import get_settings
from app.main import app
from app.services.ai.deps import get_estimate_source
from app.services.ai.schemas import PhotoCalorieEstimate, PhotoMacros

ESTIMATE = "/api/v1/logs/estimate-photo"

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _upload(data: bytes, name: str = "meal.png", content_type: str = "image/png") -> dict:
    return {"file": (name, data, content_type)}


def _large_photo(width: int = 3000, height: int = 2000) -> bytes:
    image = Image.new("RGB", (width, height), color=(120, 40, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def live_estimate_source():
    """Override just the source signal, so the route takes the "ai" branch
    while the actual estimator stays the safe deterministic stub."""
    app.dependency_overrides[get_estimate_source] = lambda: "ai"
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_estimate_source, None)


# --- the fake provider skips all of it ---


async def test_the_fake_provider_is_never_rate_limited(auth_client: AsyncClient) -> None:
    """The suite's default mode -- no live_estimate_source override -- proves
    tests and local dev are not throttled by a limit meant for paid calls."""
    limit = get_settings().photo_estimate_rate_limit

    statuses = [
        (await auth_client.post(ESTIMATE, files=_upload(PNG))).status_code for _ in range(limit + 2)
    ]

    assert 429 not in statuses, f"the fake provider was throttled: {statuses}"
    assert all(code == 200 for code in statuses)


async def test_the_kill_switch_has_no_effect_on_the_fake_provider(
    auth_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "photo_estimate_enabled", False)

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text


async def test_the_response_names_ai_once_the_live_source_is_in_play(
    auth_client: AsyncClient, live_estimate_source
) -> None:
    """The fake-provider case is covered in test_photo_estimation_endpoint.py;
    this is the other branch, proving estimate_source on the response really
    does track get_estimate_source() rather than being hardcoded to "local"."""
    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text
    assert response.json()["estimate_source"] == "ai"


# --- the short-window and daily rate limits ---


async def test_too_many_estimates_in_the_short_window_are_refused(
    auth_client: AsyncClient, live_estimate_source
) -> None:
    limit = get_settings().photo_estimate_rate_limit

    statuses = [
        (await auth_client.post(ESTIMATE, files=_upload(PNG))).status_code for _ in range(limit + 2)
    ]

    assert 429 in statuses, f"photo estimation was never throttled: {statuses}"


async def test_the_daily_cap_catches_what_the_short_window_would_allow(
    auth_client: AsyncClient, live_estimate_source, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A short window resets every hour; the daily cap is the second ceiling
    that still applies to someone who paces themselves just under it all day.
    Raising the short-window limit out of the way isolates this one."""
    settings = get_settings()
    monkeypatch.setattr(settings, "photo_estimate_rate_limit", 1000)
    monkeypatch.setattr(settings, "photo_estimate_daily_limit", 3)

    statuses = [
        (await auth_client.post(ESTIMATE, files=_upload(PNG))).status_code for _ in range(5)
    ]

    assert 429 in statuses, f"the daily cap was never enforced: {statuses}"


async def test_a_429_carries_a_retry_after_header(
    auth_client: AsyncClient, live_estimate_source
) -> None:
    """The same shape every other rate limit in this app already answers with,
    so the client's existing 429 handling covers this route for free."""
    limit = get_settings().photo_estimate_rate_limit

    responses = [await auth_client.post(ESTIMATE, files=_upload(PNG)) for _ in range(limit + 1)]

    blocked = next(r for r in responses if r.status_code == 429)
    assert "Retry-After" in blocked.headers


# --- the kill switch, live ---


async def test_the_kill_switch_takes_the_route_out_of_service(
    auth_client: AsyncClient, live_estimate_source, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "photo_estimate_enabled", False)

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 503, response.text
    assert "temporarily unavailable" in response.json()["detail"].lower()


async def test_the_kill_switch_does_not_spend_the_rate_limit(
    auth_client: AsyncClient, live_estimate_source, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Refused before the limiter is even touched, so flipping the switch back
    on does not hand back an allowance that was quietly burned while it was off."""
    settings = get_settings()
    monkeypatch.setattr(settings, "photo_estimate_enabled", False)
    for _ in range(3):
        await auth_client.post(ESTIMATE, files=_upload(PNG))
    monkeypatch.setattr(settings, "photo_estimate_enabled", True)

    response = await auth_client.post(ESTIMATE, files=_upload(PNG))

    assert response.status_code == 200, response.text


# --- server-side downscaling ---


async def test_the_photo_is_downscaled_before_reaching_the_estimator(
    auth_client: AsyncClient, live_estimate_source
) -> None:
    captured: dict[str, bytes | str] = {}

    class _CapturingAI:
        async def adjust_calories(self, req):
            raise NotImplementedError

        async def generate_plan(self, req):
            raise NotImplementedError

        async def estimate_from_photo(self, image: bytes, content_type: str):
            captured["image"] = image
            captured["content_type"] = content_type
            return PhotoCalorieEstimate(
                dish_guess="test dish",
                calories=500,
                macros=PhotoMacros(protein_g=20, carbs_g=50, fat_g=15),
                confidence="medium",
            )

    from app.services.ai.deps import get_ai_service

    app.dependency_overrides[get_ai_service] = lambda: _CapturingAI()
    try:
        original = _large_photo(3000, 2000)
        response = await auth_client.post(ESTIMATE, files=_upload(original, "big.png"))
    finally:
        app.dependency_overrides.pop(get_ai_service, None)

    assert response.status_code == 200, response.text
    assert captured["content_type"] == "image/jpeg"
    sent = captured["image"]
    assert isinstance(sent, bytes)
    assert len(sent) < len(original)
    with Image.open(io.BytesIO(sent)) as decoded:
        assert decoded.format == "JPEG"
        assert max(decoded.size) <= 1024


async def test_a_corrupt_photo_is_refused_cleanly_rather_than_crashing(
    auth_client: AsyncClient, live_estimate_source
) -> None:
    """Passes _sniff (a real PNG signature) but is truncated past the header,
    so Pillow cannot decode it -- this must be a 422, not a 500."""
    truncated = PNG[:12]

    response = await auth_client.post(ESTIMATE, files=_upload(truncated))

    assert response.status_code == 422, response.text
