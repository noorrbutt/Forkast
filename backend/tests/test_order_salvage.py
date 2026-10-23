"""Salvaging a delivery-order reply that ORDER_MAX_TOKENS cut off mid-item.

Exercises GroqAIService.estimate_order directly, with a fake HTTP client
standing in for Groq -- the same shape test_photo_estimation.py already uses
for the sibling vision seam. ORDER_SCHEMA's field names are the short wire
names (r/i/n/q/lo/hi/c); _build_order_estimate is what translates those back
to OrderLineItem's ordinary ones, and these tests hand it raw JSON text the
same way a real, possibly truncated, Groq reply would arrive.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from app.services.ai.groq_service import (
    ORDER_ITEM_LIMIT,
    VISION_MODEL,
    GroqAIService,
    GroqResponseError,
    _salvage_order_json,
)

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


def _item(n: str, q: int = 1, lo: int = 100, hi: int = 200, c: str = "h") -> dict:
    return {"n": n, "q": q, "lo": lo, "hi": hi, "c": c}


def _reply(items: list[dict], r: str | None = None) -> str:
    return json.dumps({"r": r, "i": items})


# --- _salvage_order_json, as a pure function ---


def test_salvage_recovers_every_complete_item_before_the_cut() -> None:
    whole = _reply([_item("biryani"), _item("coke", q=2)], r="Student Biryani")
    # Cut partway through what would have been a third item, mid-string,
    # with no closing brackets at all -- the shape ORDER_MAX_TOKENS running
    # out actually produces.
    cut = whole[: whole.rfind("]")] + ', {"n": "fries", "q": 1, "lo": 3'

    salvaged = _salvage_order_json(cut)

    assert salvaged is not None
    assert salvaged["r"] == "Student Biryani"
    assert [item["n"] for item in salvaged["i"]] == ["biryani", "coke"]


def test_salvage_returns_none_when_the_cut_lands_before_any_complete_item() -> None:
    cut = '{"r": "Student Biryani", "i": [{"n": "biryani", "q": 1, "lo": 6'

    assert _salvage_order_json(cut) is None


def test_salvage_returns_none_when_there_is_no_items_array_at_all() -> None:
    assert _salvage_order_json("not even json") is None
    assert _salvage_order_json('{"r": "Student Biryani"') is None


def test_salvage_tolerates_a_missing_or_malformed_restaurant_name() -> None:
    cut = '{"i": [{"n": "biryani", "q": 1, "lo": 600, "hi": 800, "c": "h"}'

    salvaged = _salvage_order_json(cut)

    assert salvaged is not None
    assert salvaged["r"] is None
    assert len(salvaged["i"]) == 1


# --- estimate_order, salvage path ---


async def test_a_reply_cut_mid_item_still_returns_the_completed_items() -> None:
    whole = _reply([_item("biryani", lo=650, hi=850), _item("coke", q=2, lo=140, hi=180)])
    cut = whole[: whole.rfind("]")] + ', {"n": "fries", "q": 1, "lo": 3'
    service = GroqAIService(_FakeClient(cut), model="openai/gpt-oss-20b")

    result = await service.estimate_order(PNG, "image/png")

    assert result.truncated is True
    assert [item.name for item in result.items] == ["biryani", "coke"]
    assert result.items[0].kcal_min == 650 and result.items[0].kcal_max == 850


async def test_a_reply_cut_with_zero_recoverable_items_is_not_treated_as_truncated() -> None:
    """Nothing salvageable keeps the ordinary error path: it is retried up
    to MAX_ATTEMPTS, and the fake client fails the same way every time, so
    this must still end in the same GroqResponseError a genuinely unusable
    reply always has -- never a success with an empty, falsely truncated list.
    """
    cut = '{"i": [{"n": "biryani", "q": 1, "lo": 6'
    service = GroqAIService(_FakeClient(cut), model="openai/gpt-oss-20b")

    try:
        await service.estimate_order(PNG, "image/png")
        raised = False
    except GroqResponseError:
        raised = True
    assert raised, "a reply with nothing salvageable must still fail, not succeed empty"


async def test_a_cleanly_parsed_reply_is_never_marked_truncated() -> None:
    service = GroqAIService(_FakeClient(_reply([_item("biryani")])), model="openai/gpt-oss-20b")

    result = await service.estimate_order(PNG, "image/png")

    assert result.truncated is False


async def test_a_salvaged_reply_is_not_retried() -> None:
    """A second, equally truncated attempt would tell us nothing a first
    one did not -- see _salvage_order_json's own docstring -- so exactly one
    call should go out once anything was salvaged."""
    whole = _reply([_item("biryani"), _item("coke")])
    cut = whole[: whole.rfind("]")] + ', {"n": "fries", "q": 1, "lo": 3'
    client = _FakeClient(cut)
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    await service.estimate_order(PNG, "image/png")

    assert len(client.completions.calls) == 1


async def test_the_item_cap_still_applies_to_a_salvaged_reply() -> None:
    items = [_item(f"item {i}") for i in range(ORDER_ITEM_LIMIT + 5)]
    whole = _reply(items)
    cut = whole[: whole.rfind("]")] + ', {"n": "cut off", "q": 1, "lo": 1'
    service = GroqAIService(_FakeClient(cut), model="openai/gpt-oss-20b")

    result = await service.estimate_order(PNG, "image/png")

    assert len(result.items) == ORDER_ITEM_LIMIT


async def test_confidence_codes_are_translated_back_to_their_full_words() -> None:
    reply = _reply([_item("a", c="h"), _item("b", c="m"), _item("c", c="l"), _item("d", c="?")])
    service = GroqAIService(_FakeClient(reply), model="openai/gpt-oss-20b")

    result = await service.estimate_order(PNG, "image/png")

    assert [item.confidence for item in result.items] == ["high", "medium", "low", "low"]


async def test_the_request_uses_the_vision_model() -> None:
    client = _FakeClient(_reply([_item("biryani")]))
    service = GroqAIService(client, model="openai/gpt-oss-20b")

    await service.estimate_order(PNG, "image/png")

    assert client.completions.calls[0]["model"] == VISION_MODEL
