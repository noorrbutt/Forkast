"""Proof that AI_PROVIDER=groq works against the real Groq API.

    python -m scripts.live_ai_check                       # defaults to localhost:8010
    python -m scripts.live_ai_check --base-url http://192.168.1.5:8010

The pytest suite only ever drives GroqAIService with a stand-in client (see
tests/test_groq_service.py) -- that proves the request shapes, retries and
error handling are right, but never actually calls Groq. This script is the
other half: it runs against a live server with AI_PROVIDER=groq and the
demo@forkast.app account, and makes the three calls that touch the model --
a text calorie estimate, a plan, and a photo estimate -- for real.

It is not a substitute for the pytest suite and does not replace it. It is a
thing to run once by hand before a deploy, the same role scripts/smoke.py
plays for the rest of the API.

Exits non-zero on the first thing that does not hold, including a schema
violation (the response does not parse as the shape the client expects) or a
clamp violation (a calorie figure lands outside the category's own range,
which the server is supposed to enforce regardless of what the model said).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx
from pydantic import ValidationError

from app.services.ai.schemas import PhotoCalorieEstimate

FIXTURE = Path(__file__).parent / "fixtures" / "sample_meal.jpg"

passed = 0
failed: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed.append(label)
        print(f"  FAIL  {label}  {detail}")


def section(title: str) -> None:
    print(f"\n--- {title} ---")


class _Abort(Exception):
    """Raised when a later check would be meaningless without this one.

    Caught once, right before the summary prints -- so a login or log-create
    call that comes back non-2xx still shows up in the PASS/FAIL list and the
    final tally, instead of the script dying mid-run with a bare traceback."""


def timed(label: str, call):
    """Run `call`, print PASS/FAIL with latency, and return its response.

    A non-2xx status or a raised exception is itself a FAIL -- there is no
    path through this function that silently swallows either, since a script
    whose job is proving Groq actually works must fail loudly on anything
    that is not a clean success. Everything after this call in the same
    section almost always reads the response body, so a failure here aborts
    the run rather than letting those reads fail confusingly on `None`.
    """
    started = time.monotonic()
    try:
        response = call()
    except Exception as exc:
        elapsed = time.monotonic() - started
        check(f"{label} ({elapsed:.2f}s)", False, f"raised {exc!r}")
        raise _Abort from exc
    elapsed = time.monotonic() - started
    ok = 200 <= response.status_code < 300
    check(f"{label} ({elapsed:.2f}s)", ok, f"status {response.status_code}: {response.text[:200]}")
    if not ok:
        raise _Abort
    return response


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8010")
    args = parser.parse_args()
    api = f"{args.base_url}/api/v1"

    try:
        _run(api, args.base_url)
    except _Abort:
        pass

    print(f"\n{'=' * 46}")
    print(f"  {passed} passed, {len(failed)} failed")
    if failed:
        for name in failed:
            print(f"    FAILED: {name}")
    print("=" * 46)
    return 1 if failed else 0


def _run(api: str, base_url: str) -> None:
    with httpx.Client(timeout=60.0) as http:
        section("preflight")
        r = http.get(f"{base_url}/health")
        check("server is reachable", r.status_code == 200, r.text)
        provider = r.json().get("ai_provider") if r.status_code == 200 else None
        check(
            "AI_PROVIDER is groq (a live check against the fake provider proves nothing)",
            provider == "groq",
            f"got ai_provider={provider!r}",
        )
        if provider != "groq":
            print("\nStopping here: set AI_PROVIDER=groq on the server and restart it.")
            raise _Abort

        r = http.get(f"{base_url}/ready")
        ready = r.json() if r.status_code == 200 else {}
        print(f"        /ready: ai_text={ready.get('ai_text')} ai_vision={ready.get('ai_vision')}")

        section("sign in as the demo account")
        r = timed(
            "demo login",
            lambda: http.post(
                f"{api}/auth/login", json={"email": "demo@forkast.app", "password": "demo1234"}
            ),
        )
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

        r = http.get(f"{api}/categories", headers=auth)
        check("categories available", r.status_code == 200 and len(r.json()) > 0, r.text)
        categories = r.json()
        biryani = next(c for c in categories if c["slug"] == "biryani")

        section("(a) calorie adjust")
        # There is no standalone "adjust calories" endpoint -- adjust_calories
        # runs as a background refinement job after a log is created (see
        # services/logs.py's refine_estimate). Creating a category-priced log
        # and waiting for its figure to come back refined is what actually
        # exercises a live text-model call end to end; a provisional estimate
        # that never refines would mean the call either never happened or
        # never landed.
        created = timed(
            "create a category-priced log",
            lambda: http.post(
                f"{api}/logs",
                headers=auth,
                json={
                    "dish_name": "chicken biryani",
                    "category_id": biryani["id"],
                    "rating": 4,
                    "serving_size": "medium",
                },
            ),
        ).json()
        check(
            "provisional estimate is inside the category range",
            biryani["base_calorie_min"]
            <= created["estimated_calories"]
            <= biryani["base_calorie_max"],
            f"{created['estimated_calories']} not in "
            f"{biryani['base_calorie_min']}-{biryani['base_calorie_max']}",
        )

        refined = None
        started = time.monotonic()
        deadline = started + 20.0
        while time.monotonic() < deadline:
            r = http.get(f"{api}/logs/{created['id']}", headers=auth)
            body = r.json()
            if body.get("refined"):
                refined = body
                break
            time.sleep(0.5)
        elapsed = time.monotonic() - started

        check(
            f"refinement landed ({elapsed:.2f}s)",
            refined is not None,
            "still provisional after 20s",
        )
        if refined is not None:
            check(
                "refined estimate is inside the category range (the model is asked to "
                "stay inside it, but the server clamps regardless of what it answers)",
                biryani["base_calorie_min"]
                <= refined["estimated_calories"]
                <= biryani["base_calorie_max"],
                f"{refined['estimated_calories']} not in "
                f"{biryani['base_calorie_min']}-{biryani['base_calorie_max']}",
            )
            check(
                "calorie_source is category",
                refined.get("calorie_source") == "category",
                str(refined),
            )
            print(f"        refined estimate: {refined['estimated_calories']} kcal")

        http.delete(f"{api}/logs/{created['id']}", headers=auth)

        section("(b) generate plan")
        r = timed(
            "generate a plan",
            lambda: http.post(f"{api}/plans", headers=auth, json={"goal": "maintain"}),
        )
        plan = r.json()
        generated = plan.get("generated_plan", {})
        check("plan has a summary", bool(generated.get("summary")), str(generated)[:200])
        check("plan has at least one day", len(generated.get("days", [])) > 0, str(generated)[:200])
        check(
            "every day has at least one meal",
            all(len(day.get("meals", [])) > 0 for day in generated.get("days", [])),
            str(generated.get("days"))[:300],
        )
        check("plan has nudges", len(generated.get("nudges", [])) > 0, str(generated)[:200])
        check("plan estimate_source is ai", plan.get("estimate_source") == "ai", str(plan))
        print(f"        summary: {generated.get('summary', '')[:120]}")

        section("(c) photo estimate")
        if not FIXTURE.exists():
            check(
                "sample_meal.jpg is present",
                False,
                f"missing {FIXTURE} -- add a real food photo there and re-run",
            )
        else:
            image_bytes = FIXTURE.read_bytes()
            r = timed(
                "estimate a photo",
                lambda: http.post(
                    f"{api}/logs/estimate-photo",
                    headers=auth,
                    files={"file": ("sample_meal.jpg", image_bytes, "image/jpeg")},
                ),
            )
            raw = r.json()
            try:
                estimate = PhotoCalorieEstimate.model_validate(raw)
            except ValidationError as exc:
                check("photo estimate matches PhotoCalorieEstimate's schema", False, str(exc))
            else:
                check("photo estimate matches PhotoCalorieEstimate's schema", True)
                check("dish guess is non-empty", bool(estimate.dish_guess), str(raw))
                check(
                    "calories is a plausible positive figure",
                    0 < estimate.calories < 5000,
                    str(raw),
                )
                check(
                    "portion_options only present when portion_ambiguous",
                    estimate.portion_ambiguous or not estimate.portion_options,
                    str(raw),
                )
                print(
                    f"        dish_guess={estimate.dish_guess!r} "
                    f"calories={estimate.calories} confidence={estimate.confidence}"
                )


if __name__ == "__main__":
    sys.exit(main())
