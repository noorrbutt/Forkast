# Forkast

Food logging that reads more like a diary than a tracker. You log what you ate,
the app estimates the calories from the dish and its category, and the dashboard
tells you the things you would actually want to know: how much of the week was
junk, where you eat most, and how long you have gone without a junk meal.

- **Backend**: FastAPI, PostgreSQL 18, SQLAlchemy 2, Alembic
- **App**: React Native on Expo SDK 57, Expo Router
- **AI**: Groq, server side only

## What is real and what is not

| Area | State |
|---|---|
| Auth, food log CRUD, search, restaurants | Real |
| Dashboard and streaks | Real, computed per request from `food_logs` |
| Calorie estimation | Real, with a deterministic local estimator by default |
| Groq | Implemented, off by default. Set `AI_PROVIDER=groq` and a key |
| Map | Real, except in Expo Go on Android. See [The map](#the-map) |

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.14 | Via conda below. Older works, but the pins were resolved against 3.14 |
| Node | 22.13 or newer | Expo SDK 57's floor. Nothing enforces it, so it fails off contract rather than loudly |
| PostgreSQL | 18 | Needs `pg_trgm`, which ships with it |
| conda | any | Only to create the environment |

## Setup

### 1. Python environment

```bash
conda create -n forkast python=3.14 -y
conda activate forkast
pip install -r backend/requirements.txt --only-binary :all:
```

`--only-binary :all:` is deliberate. It turns a missing wheel into a loud
failure instead of a silent source build that may or may not find a compiler.
The pins are exact for the same reason: SQLAlchemy is held at 2.0.53 because
2.0.54 shipped without a wheel for Python 3.14.

### 2. Databases

```bash
createdb -U postgres forkast
createdb -U postgres forkast_test
```

### 3. Configuration

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env`: set the two database URLs and generate a JWT secret
with `openssl rand -hex 32`. The file is gitignored and has never been
committed.

### 4. Schema and demo data

```bash
cd backend
alembic upgrade head
python -m app.seed.run
```

That gives you 10 cuisines, 38 categories, 10 Karachi restaurants, and a demo
account with 120 logs across 90 days, so every screen has something in it:

```
demo@forkast.app / demo1234
```

The seeded history is deterministic apart from the anchor date, so the same
numbers come out each time while the logs stay positioned relative to today.

### 5. Run it

```bash
# backend, from backend/
uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload

# app, from mobile/
npm install
npx expo start
```

## Two things that will waste your afternoon

**Port 8010, not 8000.** Another project on the original dev machine owns 8000.
Windows lets two processes bind the same port rather than refusing, so the
symptom is not a bind error, it is your requests being answered by the wrong
server. If a response looks like it came from a different app, that is why.

**`localhost` does not work from a phone.** Expo Go runs on the handset, where
`localhost` is the handset. Put your machine's LAN address in
`mobile/.env.local`:

```
EXPO_PUBLIC_API_URL=http://192.168.1.10:8010
```

Find it with `ipconfig` (the Wi-Fi adapter's IPv4 address). It is a DHCP lease,
so it changes when you rejoin the network. After editing it, do a full reload in
Expo Go; hot refresh will not pick it up and you will chase a ghost.

Only `EXPO_PUBLIC_API_URL` may carry that prefix. Expo inlines `EXPO_PUBLIC_`
values into the shipped bundle in plaintext, so a secret behind it is a secret
you have published.

### On Windows, also

The phone cannot reach the laptop until the firewall allows it, and if Windows
has classified the network as Public then Private profile rules do not apply at
all. Check with `Get-NetConnectionProfile`, then in an elevated shell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
New-NetFirewallRule -DisplayName "Forkast API" -Direction Inbound -LocalPort 8010 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Expo Metro"  -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private
```

Expo Go on SDK 57 also requires signing in twice: `npx expo login` in the
terminal, and again inside the Expo Go app itself. A QR scan alone will fail.

## Tests

```bash
cd backend
pytest                      # the suite, against forkast_test
alembic check               # models and migrations have not drifted
python -m scripts.smoke     # live end to end over real HTTP, needs the server running
```

```bash
cd mobile
npx tsc --noEmit
npx jest                    # includes the contrast and web parity checks
npx expo-doctor
```

Tests run against the real `forkast_test` database rather than a mock, so every
run also re-proves that `alembic upgrade head` works on an empty database. That
matters more than it sounds: the drift check cannot see CHECK constraints at
all, so it reported everything was fine while four of them were missing
entirely.

The live smoke test exists alongside pytest because it proves something the
suite structurally cannot. A bug where writes committed after the response was
sent was invisible in process and only appeared once a network round trip was
involved.

### Rolling migrations back

`alembic downgrade base` refuses to run while any food logs exist. That is
deliberate, not a bug: migration 0002 owns the reference categories, and logs
point at them with `ON DELETE RESTRICT`. Clear the data first.

```bash
python -m app.seed.run --reset   # removes the demo account only
alembic downgrade base
```

If other accounts exist, remove those too. The transaction rolls back cleanly if
you forget, so a failed attempt leaves the database intact.

## Turning on Groq

```
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

The app refuses to start with `groq` and no key, so a missing key is not
discovered on the first request. Leave `GROQ_MODEL` alone unless you have a
reason: `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` were shut down on
2026-08-16 while still appearing on Groq's models page, and a test guards
against one creeping back in.

Both calls use strict structured output, and the calorie result is clamped into
the category range on our side regardless of what comes back. A schema
constrains the shape of a reply, never the number inside it.

The Groq path is covered by tests that inject a stand-in client, so no key is
needed to run the suite. What those cannot tell you is whether Groq itself
behaves as documented. That still needs a live key.

## The map

It draws real pins everywhere except Expo Go on Android, where it falls back to
a list grouped by area.

Expo removed Google Maps from the Expo Go client on Android in SDK 53, and
Google is the only provider `react-native-maps` has there, so a map renders as a
blank grey rectangle. No API key fixes it, because in Expo Go the app runs under
Expo's package name and signature and a config plugin only applies during a
native build.

To get it on Android, build a development client:

```bash
npx expo login
GOOGLE_MAPS_API_KEY=... eas build --profile development --platform android
```

The key goes in the environment rather than the repo. It ships inside the APK
either way, so restrict it by package name and SHA-1 in the Google Cloud console
instead of treating the file as the control.

## Layout

```
backend/
  app/
    api/v1/        routes
    models/        SQLAlchemy models
    schemas/       request and response models
    services/      auth, calories, insights, the AI seam
    seed/          reference data and the demo seeder
  alembic/         migrations
  scripts/smoke.py live end to end check
  tests/
mobile/
  app/             Expo Router routes
  components/      UI primitives and screen pieces
  hooks/           TanStack Query hooks
  lib/             API client, token storage, types
  theme/           design tokens, light and dark
```

A few decisions worth knowing before you change things:

- **Closed vocabularies are varchar with a CHECK, never a native Postgres enum.**
  A native enum cannot drop a value and leaves the type behind on downgrade, so
  `downgrade base` then `upgrade head` fails with "type already exists".
- **Streaks are computed, never stored.** A stored counter is a second source of
  truth that drifts the moment a log is edited or deleted.
- **Days are the user's local days.** `users.timezone` drives the bucketing. In
  Karachi a UTC day rolls over at 5am local, so bucketing by UTC files a late
  dinner on the wrong day and makes both the chart and the streak quietly wrong.
- **The calorie clamp happens before the serving multiplier.** The model's job is
  only to place a dish inside its category range; a large portion is then
  allowed to exceed that range.
- **Every colour lives in `mobile/theme/tokens.ts`.** There are no hex literals
  anywhere else, so restyling never touches a screen.
