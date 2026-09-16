"""Live end to end smoke test against a running Forkast server.

    python -m scripts.smoke                       # defaults to 127.0.0.1:8010
    python -m scripts.smoke http://192.168.1.5:8010

Hits every route over real HTTP, in the order a real client would, and exits
non zero on the first thing that does not hold.

This exists alongside the pytest suite rather than inside it because it proves
something the suite cannot: that a real uvicorn process, a real socket and a
real database agree. The write durability bug this project hit earlier was
invisible in process, because the response and the commit raced only once a
network round trip was involved.

It is safe to run repeatedly. Each run registers a fresh account and names its
own restaurant, so nothing depends on state left by an earlier run.
"""

from __future__ import annotations

import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"
API = f"{BASE}/api/v1"

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


with httpx.Client(timeout=30.0) as http:
    section("health")
    r = http.get(f"{BASE}/health")
    check("health returns ok", r.status_code == 200 and r.json()["status"] == "ok", r.text)
    check("ai provider is the stub", r.json().get("ai_provider") == "fake", r.text)

    section("auth")
    email = f"smoke-{int(time.time())}@forkast.app"
    r = http.post(f"{API}/auth/register", json={"email": email, "password": "password123"})
    check("register returns 201", r.status_code == 201, r.text)
    tokens = r.json()
    access, refresh_token = tokens["access_token"], tokens["refresh_token"]
    auth = {"Authorization": f"Bearer {access}"}

    r = http.post(f"{API}/auth/register", json={"email": email, "password": "password123"})
    check("duplicate register is rejected", r.status_code == 409, r.text)

    r = http.post(f"{API}/auth/login", json={"email": email, "password": "password123"})
    check("login returns 200", r.status_code == 200, r.text)

    r = http.post(f"{API}/auth/login", json={"email": email, "password": "wrong"})
    check("bad password is rejected", r.status_code == 401, r.text)

    r = http.post(f"{API}/auth/refresh", json={"refresh_token": refresh_token})
    check("refresh returns a new pair", r.status_code == 200, r.text)
    rotated = r.json()["refresh_token"]
    check("refresh token actually rotated", rotated != refresh_token)

    r = http.post(f"{API}/auth/refresh", json={"refresh_token": refresh_token})
    check("the old refresh token is dead", r.status_code == 401, r.text)

    r = http.get(f"{API}/auth/me", headers=auth)
    check("auth/me returns the user", r.status_code == 200 and r.json()["email"] == email, r.text)

    r = http.get(f"{API}/logs")
    check("anonymous access is refused", r.status_code == 401, r.text)

    section("profile")
    r = http.patch(f"{API}/me", headers=auth, json={"goal": "cut"})
    check("goal can be updated", r.status_code == 200 and r.json()["goal"] == "cut", r.text)

    section("catalog")
    r = http.get(f"{API}/cuisines", headers=auth)
    cuisines = r.json()
    check("cuisines are listed", r.status_code == 200 and len(cuisines) >= 8, r.text)

    r = http.get(f"{API}/categories", headers=auth)
    categories = r.json()
    check("categories are listed", r.status_code == 200 and len(categories) >= 30, r.text)

    desi = next(c for c in cuisines if c["slug"] == "desi")
    r = http.get(f"{API}/categories", headers=auth, params={"cuisine_id": desi["id"]})
    check("categories filter by cuisine", 0 < len(r.json()) < len(categories), r.text)

    r = http.get(f"{API}/search", headers=auth, params={"q": "biriani"})
    hits = [c["slug"] for c in r.json()["categories"]]
    check("misspelled search still finds biryani", "biryani" in hits, str(hits))

    section("restaurants")
    # A unique name per run, so the first call is genuinely a creation and 201
    # is the right expectation rather than an accident of earlier runs.
    cafe = f"Smoke Cafe {int(time.time())}"
    r = http.post(f"{API}/restaurants", headers=auth, json={"name": cafe, "area": "Clifton"})
    check("restaurant created returns 201", r.status_code == 201, r.text)
    first_id = r.json()["id"]
    r = http.post(f"{API}/restaurants", headers=auth, json={"name": f"  {cafe.lower()}", "area": "CLIFTON"})
    check("deduped restaurant returns 200, not 201", r.status_code == 200, f"got {r.status_code}")
    check("restaurant dedupes case insensitively", r.json()["id"] == first_id, r.text)

    section("food logs")
    biryani = next(c for c in categories if c["slug"] == "biryani")
    r = http.post(
        f"{API}/logs",
        headers=auth,
        json={
            "dish_name": "chicken biryani",
            "category_id": biryani["id"],
            "restaurant_name": cafe,
            "area": "Clifton",
            "rating": 5,
            "fun_scale": 5,
            "friend_scale": "squad",
            "serving_size": "medium",
        },
    )
    check("log created", r.status_code == 201, r.text)
    log = r.json()
    check(
        "calories estimated inside the category range",
        biryani["base_calorie_min"] <= log["estimated_calories"] <= biryani["base_calorie_max"],
        f"{log['estimated_calories']} not in "
        f"{biryani['base_calorie_min']}-{biryani['base_calorie_max']}",
    )
    check("category joined into the response", log["category"]["slug"] == "biryani", r.text)
    check("restaurant linked", log["restaurant_id"] == first_id, r.text)

    r = http.get(f"{API}/logs", headers=auth)
    check("logs list", r.status_code == 200 and r.json()["total"] == 1, r.text)

    r = http.get(f"{API}/logs/{log['id']}", headers=auth)
    check("single log fetch", r.status_code == 200, r.text)

    r = http.patch(f"{API}/logs/{log['id']}", headers=auth, json={"serving_size": "large"})
    check(
        "editing serving size recalculates calories",
        r.status_code == 200 and r.json()["estimated_calories"] > log["estimated_calories"],
        r.text,
    )

    r = http.post(
        f"{API}/logs",
        headers=auth,
        json={"dish_name": "x", "category_id": 99999, "rating": 4, "serving_size": "medium"},
    )
    check("bad category id gives 422 not 500", r.status_code == 422, f"got {r.status_code}")

    r = http.delete(f"{API}/logs/{log['id']}", headers=auth)
    check("log deleted", r.status_code == 204, r.text)

    section("insights")
    # This account logged one meal and then deleted it, so the dashboard has to
    # come back empty. That is a stronger check than a non-zero number: it only
    # holds if the figures are really computed from this user's own rows.
    r = http.get(f"{API}/dashboard", headers=auth)
    dash = r.json()
    check("dashboard responds", r.status_code == 200, r.text)
    check("dashboard has no placeholder marker", "_source" not in dash, str(dash)[:120])
    check("dashboard reflects this account only", dash["logs_count"] == 0, str(dash["logs_count"]))
    check("burn equivalents present", "walking_minutes" in dash["burn_equivalents"], r.text)

    r = http.get(f"{API}/streaks", headers=auth)
    streaks = r.json()
    check("streaks responds", r.status_code == 200, r.text)
    check("streaks has no placeholder marker", "_source" not in streaks, str(streaks)[:120])
    check("streaks message is present", bool(streaks["message"]), r.text)

    r = http.post(f"{API}/plans", headers=auth, json={"goal": "cut"})
    check("plan generated", r.status_code == 201, r.text)
    plan = r.json()
    check("plan has days and nudges", bool(plan["generated_plan"]["days"]), r.text)
    check("plan goal snapshotted", plan["goal"] == "cut", r.text)

    r = http.get(f"{API}/plans", headers=auth)
    check("plans listed", r.status_code == 200 and len(r.json()) == 1, r.text)

    section("seeded demo account")
    r = http.post(f"{API}/auth/login", json={"email": "demo@forkast.app", "password": "demo1234"})
    check("demo account can log in", r.status_code == 200, r.text)
    if r.status_code == 200:
        demo_auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = http.get(f"{API}/logs", headers=demo_auth, params={"limit": 5})
        check("demo account has seeded history", r.json()["total"] >= 100, str(r.json()["total"]))
        r = http.get(f"{API}/search", headers=demo_auth, params={"q": "biry"})
        check("demo dish history is searchable", len(r.json()["dishes"]) > 0, r.text)

        d = http.get(f"{API}/dashboard", headers=demo_auth).json()
        check("demo dashboard is computed from the seeded logs", d["logs_count"] >= 100, str(d["logs_count"]))
        check("demo junk ratio is a real fraction", 0 < d["junk_ratio"] < 1, str(d["junk_ratio"]))
        check("demo calorie chart covers 14 days", len(d["calories_by_day"]) == 14, str(len(d["calories_by_day"])))
        check("demo top category resolved", bool(d["top_category"]), str(d["top_category"]))
        s2 = http.get(f"{API}/streaks", headers=demo_auth).json()
        check("demo streak is computed", s2["longest_streak"] > 0, str(s2))

    r = http.post(f"{API}/auth/logout", headers=auth, json={"refresh_token": rotated})
    check("logout succeeds", r.status_code == 204, r.text)

print(f"\n{'=' * 46}")
print(f"  {passed} passed, {len(failed)} failed")
if failed:
    for name in failed:
        print(f"    FAILED: {name}")
print("=" * 46)
sys.exit(1 if failed else 0)
