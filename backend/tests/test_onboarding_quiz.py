"""The onboarding quiz answers: eating_out_frequency and biggest_struggle.

Both are self-reported, both are optional forever, and neither ever gates a
route -- an account that skips the quiz looks exactly like one that predates
it. The one thing worth testing on the API side is the closed vocabulary and
the null/absent PATCH distinction the calorie target already earned a test
file for.
"""

from __future__ import annotations

from httpx import AsyncClient


async def test_a_new_account_has_neither_answer(auth_client: AsyncClient) -> None:
    body = (await auth_client.get("/api/v1/me")).json()

    assert body["eating_out_frequency"] is None
    assert body["biggest_struggle"] is None


async def test_both_answers_can_be_set(auth_client: AsyncClient) -> None:
    response = await auth_client.patch(
        "/api/v1/me",
        json={"eating_out_frequency": "often", "biggest_struggle": "cravings"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["eating_out_frequency"] == "often"
    assert response.json()["biggest_struggle"] == "cravings"
    # Persisted, not just echoed in the reply.
    stored = (await auth_client.get("/api/v1/me")).json()
    assert stored["eating_out_frequency"] == "often"
    assert stored["biggest_struggle"] == "cravings"


async def test_an_unknown_answer_is_refused(auth_client: AsyncClient) -> None:
    response = await auth_client.patch("/api/v1/me", json={"eating_out_frequency": "constantly"})

    assert response.status_code == 422


async def test_leaving_the_quiz_fields_out_does_not_clear_them(
    auth_client: AsyncClient,
) -> None:
    await auth_client.patch("/api/v1/me", json={"biggest_struggle": "consistency"})

    untouched = await auth_client.patch("/api/v1/me", json={"goal": "cut"})

    assert untouched.status_code == 200
    assert untouched.json()["biggest_struggle"] == "consistency"


async def test_an_explicit_null_clears_an_answer(auth_client: AsyncClient) -> None:
    await auth_client.patch("/api/v1/me", json={"biggest_struggle": "consistency"})

    cleared = await auth_client.patch("/api/v1/me", json={"biggest_struggle": None})

    assert cleared.status_code == 200
    assert cleared.json()["biggest_struggle"] is None
