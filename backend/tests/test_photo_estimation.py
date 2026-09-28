"""Calorie estimation from a photo: the fake stub and the real Groq client.

Mirrors the shape of test_groq_service.py and test_calories.py, but for the
vision seam rather than the text one. Deliberately its own file rather than
additions to either of those: the text estimation path and its tests are not
touched by this feature at all.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.services.ai.fake import DeterministicAIService
from app.services.ai.groq_service import (
    PHOTO_CALORIE_SCHEMA,
    VISION_MODEL,
    GroqAIService,
    GroqResponseError,
)

# A real 1x1 PNG, so a byte-signature check further down the stack would
# actually pass, even though nothing here reaches that layer.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415478da6360000002000155aabe200000000049454e44ae426082"
)


class _FakeCompletions:
    def __init__(self, content: str | None = None, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


class _FakeClient:
    def __init__(self, content: str | None = None, error: Exception | None = None) -> None:
        self.completions = _FakeCompletions(content, error)
        self.chat = SimpleNamespace(completions=self.completions)


def _photo_reply(**overrides) -> str:
    body = {
        "dish_guess": "chicken biryani",
        "calories": 650,
        "protein_g": 28.0,
        "carbs_g": 70.0,
        "fat_g": 22.0,
        "confidence": "high",
        "reasoning": "full plate, visible rice and meat",
    }
    body.update(overrides)
    return json.dumps(body)


# --- the fake provider ---


async def test_the_stub_returns_a_usable_estimate() -> None:
    ai = DeterministicAIService()

    result = await ai.estimate_from_photo(PNG, "image/png")

    assert result.dish_guess
    assert result.calories > 0
    assert result.macros.protein_g > 0
    assert result.confidence in ("high", "medium", "low")


async def test_the_stub_is_deterministic_on_the_same_photo() -> None:
    ai = DeterministicAIService()

    first = await ai.estimate_from_photo(PNG, "image/png")
    second = await ai.estimate_from_photo(PNG, "image/png")

    assert first == second


async def test_the_stub_varies_with_the_photo() -> None:
    """Not a promise about realism, just that it is not returning one canned
    answer for every image, which would make the whole preview pointless."""
    ai = DeterministicAIService()

    a = await ai.estimate_from_photo(PNG, "image/png")
    b = await ai.estimate_from_photo(PNG + b"\x00", "image/png")

    assert (a.dish_guess, a.calories) != (b.dish_guess, b.calories)


async def test_the_stub_ignores_the_declared_content_type() -> None:
    """Matches the real method's signature exactly, but has nothing to do with
    it: the fake never looks at the bytes at all."""
    ai = DeterministicAIService()

    png_labelled = await ai.estimate_from_photo(PNG, "image/png")
    jpeg_labelled = await ai.estimate_from_photo(PNG, "image/jpeg")

    assert png_labelled == jpeg_labelled


async def test_the_stub_and_the_groq_client_stay_interchangeable() -> None:
    """The Protocol only pays off if both sides genuinely implement it."""
    from app.services.ai.base import AIService

    stub = DeterministicAIService()
    real = GroqAIService(client=None, model="openai/gpt-oss-20b")

    assert isinstance(stub, AIService)
    assert isinstance(real, AIService)


# --- the real Groq client, exercised without a network call ---


async def test_the_request_uses_the_vision_model_not_the_configured_one() -> None:
    """The text seams use whatever GROQ_MODEL is configured to; the photo seam
    always uses the vision-capable model regardless, since a text-only model
    cannot read an image at all."""
    client = _FakeClient(_photo_reply())
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    await service.estimate_from_photo(PNG, "image/png")

    sent = client.completions.calls[0]
    assert sent["model"] == VISION_MODEL
    assert sent["model"] != "openai/gpt-oss-20b"


async def test_the_image_is_sent_as_an_inline_data_uri() -> None:
    """No public URL exists for an uploaded photo, so Groq has to be handed the
    bytes directly rather than a link to fetch."""
    client = _FakeClient(_photo_reply())
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    await service.estimate_from_photo(PNG, "image/png")

    content = client.completions.calls[0]["messages"][1]["content"]
    assert isinstance(content, list)
    text_blocks = [b for b in content if b["type"] == "text"]
    image_blocks = [b for b in content if b["type"] == "image_url"]
    assert len(text_blocks) == 1
    assert len(image_blocks) == 1
    url = image_blocks[0]["image_url"]["url"]
    assert url.startswith("data:image/png;base64,")


async def test_the_data_uri_respects_the_sniffed_content_type() -> None:
    client = _FakeClient(_photo_reply())
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    await service.estimate_from_photo(PNG, "image/jpeg")

    url = client.completions.calls[0]["messages"][1]["content"][1]["image_url"]["url"]
    assert url.startswith("data:image/jpeg;base64,")


async def test_the_reply_is_parsed_into_dish_and_macros() -> None:
    client = _FakeClient(
        _photo_reply(dish_guess="pepperoni pizza", calories=820, protein_g=30, carbs_g=90, fat_g=35)
    )
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    result = await service.estimate_from_photo(PNG, "image/png")

    assert result.dish_guess == "pepperoni pizza"
    assert result.calories == 820
    assert result.macros.protein_g == 30
    assert result.macros.carbs_g == 90
    assert result.macros.fat_g == 35
    assert result.confidence == "high"


async def test_a_negative_calorie_reply_is_floored_at_zero() -> None:
    """There is no known category range to clamp into here, so the only floor
    worth enforcing is zero, unlike adjust_calories which clamps into a range."""
    client = _FakeClient(_photo_reply(calories=-50))
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    result = await service.estimate_from_photo(PNG, "image/png")

    assert result.calories == 0.0


async def test_an_unrecognised_confidence_value_falls_back_to_low() -> None:
    """The schema's enum should make this unreachable in practice; this is the
    belt under the belt."""
    client = _FakeClient(_photo_reply(confidence="very sure"))
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    result = await service.estimate_from_photo(PNG, "image/png")

    assert result.confidence == "low"


@pytest.mark.parametrize(
    "content",
    ["", "not json at all", '{"dish_guess": "pizza"}'],
    ids=["empty", "not json", "missing fields"],
)
async def test_an_unusable_reply_is_reported_clearly(content: str) -> None:
    service = GroqAIService(_FakeClient(content), model="openai/gpt-oss-20b")

    with pytest.raises(GroqResponseError):
        await service.estimate_from_photo(PNG, "image/png")


async def test_the_dish_guess_and_reasoning_go_through_the_typography_filter() -> None:
    non_breaking_hyphen, em_dash = chr(0x2011), chr(0x2014)
    client = _FakeClient(
        _photo_reply(
            dish_guess=f"three{non_breaking_hyphen}cheese pizza",
            reasoning=f"cheese{em_dash}heavy, large slice",
        )
    )
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    result = await service.estimate_from_photo(PNG, "image/png")

    assert result.dish_guess == "three-cheese pizza"
    assert result.reasoning == "cheese, heavy, large slice"


def test_the_schema_is_strict_and_closed() -> None:
    assert PHOTO_CALORIE_SCHEMA["strict"] is True
    assert PHOTO_CALORIE_SCHEMA["schema"]["additionalProperties"] is False
    assert PHOTO_CALORIE_SCHEMA["schema"]["required"]


async def test_a_transport_failure_becomes_one_exception_type() -> None:
    client = _FakeClient(error=TimeoutError("connection timed out"))
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    with pytest.raises(GroqResponseError, match="Groq request failed"):
        await service.estimate_from_photo(PNG, "image/png")
