# Forkast

[![CI](https://github.com/noorrbutt/Forkast/actions/workflows/ci.yml/badge.svg)](https://github.com/noorrbutt/Forkast/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Python](https://img.shields.io/badge/python-3.14-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Expo SDK](https://img.shields.io/badge/Expo-SDK%2057-000020?logo=expo&logoColor=white)

Food logging that reads more like a diary than a tracker. You log what you ate,
the app estimates the calories from the dish and its category, and the dashboard
tells you the things you would actually want to know: how much of the week was
junk, where you eat most, and how long you have gone without a junk meal.

It is built for people who will not weigh their food. Every other tracker asks
for a barcode or a gram count and is abandoned within a fortnight for exactly
that reason. Forkast asks for the name of the dish (or a photo of it) and guesses
the rest, on the view that an estimate you will actually record beats a precise
figure you will not.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project status](#project-status)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Testing](#testing)
- [Optional integrations](#optional-integrations)
- [Deployment](#deployment)
- [Repository layout](#repository-layout)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing and security](#contributing-and-security)
- [License](#license)

## Features

- **Frictionless logging.** Name a dish or take a photo; calories are estimated
  from the dish and its category, then refined in the background. Estimates are
  always labelled as estimates.
- **Dashboard and insights.** Junk share of the week, most-visited areas, a
  calorie trend against your daily target, and a weekly digest.
- **Streaks.** Days since a junk meal, plus streak freezes. Computed per request,
  never stored.
- **Burn log.** Record activity against the day so the net figure makes sense.
- **Plans.** AI-generated meal plans grounded in your own history and target.
- **Restaurants and map.** Pins for the places you eat, with search across dishes
  and venues.
- **Accounts done properly.** Email and password or Google sign in, email
  verification, password reset, per-device session management, avatar upload,
  full data export, and account deletion.
- **Offline tolerant.** Logs made without a connection are queued and sent when
  the network returns.
- **Runs on web too.** The same screens ship as a react-native-web demo build.

## Architecture

```
┌────────────────────┐   HTTPS / JSON    ┌──────────────────────────────┐
│  Expo app          │ ────────────────► │  FastAPI  (/api/v1)          │
│  React Native      │                   │  auth · logs · insights ·    │
│  Expo Router       │ ◄──────────────── │  plans · burn · catalog      │
│  TanStack Query    │                   └───────┬───────────┬──────────┘
└────────────────────┘                           │           │
                                                 ▼           ▼
                                      ┌────────────────┐  ┌───────────────┐
                                      │ PostgreSQL 18  │  │ Groq (opt-in) │
                                      │ data + jobs    │  │ server side   │
                                      │ queue + limits │  │ only          │
                                      └───────▲────────┘  └───────────────┘
                                              │
                                      ┌───────┴────────┐
                                      │ python -m      │
                                      │ app.worker     │
                                      │ retries, email │
                                      └────────────────┘
```

| Layer | Technology |
|---|---|
| API | FastAPI, SQLAlchemy 2 (async, asyncpg), Alembic, Pydantic 2 |
| Database | PostgreSQL 18 (`pg_trgm`, `uuidv7()`) |
| Auth | Argon2 password hashing, short-lived JWT access tokens, rotating refresh tokens, Google ID token verification |
| Background work | A `jobs` table written in the same transaction as the change that needs it, drained by a worker with exponential backoff and a dead-letter state |
| AI | Groq, behind a provider seam. A deterministic local estimator is the default |
| Email | Resend |
| App | React Native 0.86 on Expo SDK 57, Expo Router, TanStack Query, Reanimated |
| CI | GitHub Actions against a real PostgreSQL 18 service container |

Postgres doubles as the job queue, the rate limiter and the AI circuit breaker
store, so there is no Redis to run.

## Project status

| Area | State |
|---|---|
| Auth, food log CRUD, search, restaurants | Real |
| Dashboard and streaks | Real, computed per request from `food_logs` |
| Calorie estimation | Real, with a deterministic local estimator by default |
| Groq | Implemented, off by default. Set `AI_PROVIDER=groq` and a key |
| Google sign in | Real, off until configured. Needs a development build |
| Map | Real, except in Expo Go on Android. See [The map](#the-map) |

## Quick start

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.14 | Via conda below. The pins were resolved against 3.14 |
| Node | 22.13 or newer | Expo SDK 57's floor. Enforced by `engines` and checked in CI |
| PostgreSQL | 18 | Needs `pg_trgm`, which ships with it. `uuidv7()` does not exist before 18 |
| conda | any | Only to create the environment |

### 1. Python environment

```bash
conda create -n forkast python=3.14 -y
conda activate forkast
pip install -r backend/requirements-dev.txt --only-binary :all:
```

`--only-binary :all:` is deliberate. It turns a missing wheel into a loud
failure instead of a silent source build that may or may not find a compiler.
The pins are exact for the same reason: SQLAlchemy is held at 2.0.53 because
2.0.54 shipped without a wheel for Python 3.14. Use `requirements.txt` instead
if you only want to run the server and not the tests or linter.

### 2. Databases

```bash
createdb -U postgres forkast
createdb -U postgres forkast_test
```

### 3. Configuration

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`: set the two database URLs and generate a JWT secret with
`openssl rand -hex 32`. The file is gitignored. The app refuses to boot with the
placeholder secret.

### 4. Schema and demo data

```bash
cd backend
alembic upgrade head
python -m app.seed.run
```

This gives you 10 cuisines, 38 categories, 10 Karachi restaurants, and a demo
account with 120 logs across 90 days, so every screen has something in it:

```
demo@forkast.app / demo1234
```

The seeded history is deterministic apart from the anchor date, so the same
numbers come out each time while the logs stay positioned relative to today. The
seeder refuses to run when `ENVIRONMENT=production`, because that password is
public.

### 5. Run it

```bash
# API, from backend/
uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload

# Job worker, from backend/, in a second terminal (see "Jobs worker")
python -m app.worker

# App, from mobile/
npm install
npx expo start
```

Check the API is up with `curl http://localhost:8010/health`. In development,
interactive docs are served at `/docs`.

The worker is optional locally, since a request runs its own job right behind its
response, but without it nothing is retried and anything interrupted by a restart
stays stuck.

## Configuration

All backend settings are environment variables, loaded from `backend/.env`.
[`backend/.env.example`](backend/.env.example) is the authoritative, commented
list. The ones you will touch most:

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `dev` | `production` disables `/docs`, `/redoc`, `/openapi.json` and the seeder |
| `DATABASE_URL` | none | Application database |
| `TEST_DATABASE_URL` | none | Test database. Must differ from `DATABASE_URL`, because the suite truncates tables |
| `JWT_SECRET` | none | Generate with `openssl rand -hex 32` |
| `AI_PROVIDER` | `fake` | `fake` is the local estimator. `groq` needs `GROQ_API_KEY` |
| `PHOTO_ESTIMATE_ENABLED` | `true` | Kill switch for photo estimation alone |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | empty | Verification and reset emails |
| `GOOGLE_CLIENT_IDS` | empty | Audiences accepted for Google sign in. Empty turns the feature off |
| `CORS_ORIGINS` | `*` | Restrict this in production |
| `TRUST_PROXY_HEADERS`, `TRUSTED_PROXY_HOPS` | `false`, `1` | Only enable behind a proxy you control, or callers can spoof their rate-limit identity |
| `SERVERLESS` | `false` | `true` only on Vercel. See [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) |
| `APP_DOMAIN` and two others | empty | App Links and Universal Links. See [below](#app-links-and-universal-links) |

Per-route rate limits, daily quotas, queue tuning and the AI circuit breaker are
all in `.env.example` with the reasoning next to each.

On the app side, only `EXPO_PUBLIC_API_URL` is required. Put it in
`mobile/.env.local`. Expo inlines every `EXPO_PUBLIC_` value into the shipped
bundle in plaintext, so never put a secret behind that prefix.

## API overview

Everything is under `/api/v1`, with the meta endpoints at the root. Full schemas
are in `/docs` when `ENVIRONMENT=dev`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/login`, `/google`, `/refresh`, `/logout`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password` |
| Account | `GET/PATCH/DELETE /auth/me`, `PUT /auth/me/password`, `GET /auth/me/export`, `/auth/me/avatar`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `POST /auth/sessions/revoke-others` |
| Food logs | `POST/GET /logs`, `GET/PATCH/DELETE /logs/{id}`, `POST /logs/estimate-photo`, `PUT/GET/DELETE /logs/{id}/photo` |
| Insights | `GET /dashboard`, `/streaks`, `/insights/reminder-signal`, `/insights/weekly-digest` |
| Plans | `POST/GET /plans`, `GET/DELETE /plans/{id}` |
| Burn | `PUT/GET /burn`, `GET /burn/today`, `DELETE /burn/{day}` |
| Catalog | `GET /cuisines`, `/categories`, `/search`, `/restaurants`, `POST /restaurants` |
| Meta | `GET /health` (liveness), `/ready` (database up, AI status), `/queue` (job backlog, dead letters, breaker state) |

Authenticated routes take `Authorization: Bearer <access token>`. Every query is
scoped to the calling user.

## Testing

There are roughly 1,000 tests: about 500 on the backend and 480 on the app.

```bash
cd backend
ruff check . && ruff format --check .
pytest                      # the suite, against forkast_test
alembic check               # models and migrations have not drifted
python -m scripts.smoke     # live end to end over real HTTP, needs the server running
```

```bash
cd mobile
npm run lint
npm run typecheck
npx jest                    # includes the contrast and web parity checks
npx expo-doctor
```

CI runs lint, migrations on an empty database, the drift check, and both test
suites on every push and pull request. See
[.github/workflows/ci.yml](.github/workflows/ci.yml). The smoke test and
`expo-doctor` are manual.

The backend suite takes a while because it uses a real database. That is a
choice:

- Tests run against the real `forkast_test` database rather than a mock, so every
  run re-proves that `alembic upgrade head` works on an empty database. That
  matters: the drift check cannot see CHECK constraints at all, so it reported
  everything was fine while four of them were missing entirely.
- The live smoke test exists alongside pytest because it proves something the
  suite structurally cannot. A bug where writes committed after the response was
  sent was invisible in process and only appeared over a network round trip.
- The Groq path is covered with an injected stand-in client, so no key is needed
  to run the suite. That cannot tell you whether Groq behaves as documented. For
  that, run `python -m scripts.live_ai_check` against a server started with a
  real key, once, before a deploy.

### Rolling migrations back

`alembic downgrade base` refuses to run while any food logs exist. That is
deliberate: migration 0002 owns the reference categories, and logs point at them
with `ON DELETE RESTRICT`. Clear the data first.

```bash
python -m app.seed.run --reset   # removes the demo account only
alembic downgrade base
```

If other accounts exist, remove those too. The transaction rolls back cleanly if
you forget, so a failed attempt leaves the database intact.

## Optional integrations

### Groq

```
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

The app refuses to start with `groq` and no key, so a missing key is not
discovered on the first request. Leave `GROQ_MODEL` alone unless you have a
reason: `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` were shut down on
2026-08-16 while still appearing on Groq's models page, and a test guards against
one creeping back in.

Calls use strict structured output, and the calorie result is clamped into the
category range on our side regardless of what comes back. A schema constrains the
shape of a reply, never the number inside it. A circuit breaker stops a failing
provider from slowing every request, and `/ready` reports text and vision status
separately.

### The map

It draws real pins everywhere except Expo Go on Android, where it falls back to a
list grouped by area.

Expo removed Google Maps from the Expo Go client on Android in SDK 53, and Google
is the only provider `react-native-maps` has there, so a map renders as a blank
grey rectangle. No API key fixes it, because in Expo Go the app runs under Expo's
package name and signature and a config plugin only applies during a native
build.

To get it on Android, build a development client:

```bash
npx expo login
eas env:create --environment development --name GOOGLE_MAPS_API_KEY --value "AIza..." --visibility secret
eas build --profile development --platform android
```

The variable is registered with EAS rather than exported in your shell, because
the build runs on EAS servers and never sees your local environment. `VAR=... eas
build` is the shape that looks obviously right and silently produces a build with
no key in it, and on PowerShell it is not even valid syntax. (`eas build --local`
does read your shell.)

The key ships inside the APK either way, so restrict it by package name and SHA-1
in the Google Cloud console rather than treating secrecy as the control.

### Continue with Google

Off unless you configure it. With no client ids the button is not drawn, the
`/auth/google` route answers 503, and everything else works exactly as before.
With no audience to check a token against, a token whose audience nobody checks
is one anybody can mint for their own Google client, so the route stays shut.

You need three OAuth clients, because Google issues one per platform and the
token the app sends carries whichever client asked for it. In the Google Cloud
console, under Google Auth Platform then Clients:

| Client | What it asks for | Where the value comes from |
| --- | --- | --- |
| Android | Package name and SHA-1 | `com.forkast.app`, and the fingerprint of whichever key signs the build |
| iOS | Bundle ID | `com.forkast.app` |
| Web | Authorised JavaScript origins and redirect URIs | the origin the browser build is served from, exactly as typed |

Register one Android client per signing key, not one in total. A debug build, an
EAS build and a Play release are signed by three different keys and Google
matches on the fingerprint.

```bash
# The key a local `npx expo run:android` build is signed with
keytool -keystore ~/.android/debug.keystore -list -v -alias androiddebugkey -storepass android

# The key EAS signs with
eas credentials
```

For the Play Store, use the fingerprint under "App signing key certificate" in
the Play Console (Test and release, Setup, App signing), not the upload key, or
sign in works for you and for nobody who installed from Play.

Then set the ids. The client ids are not secrets: an OAuth client id ships inside
the bundle. What protects an account is the API refusing a token whose audience
it was not told about. A client secret, if Google hands you one, belongs in none
of these files.

```bash
# backend/.env: web and iOS ids, comma separated. Android has no id of its own;
# that client is matched by package name and fingerprint.
GOOGLE_CLIENT_IDS=<web id>,<ios id>

# mobile/.env.local, for a local run
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web id>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios id>

# EAS, for a build, which never sees your local environment
eas env:create --environment development --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "<web id>"
eas env:create --environment development --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value "<ios id>"
```

The web client id is needed on every platform, the phone included: it is the
audience the ID token is minted for on Android. The iOS URL scheme is derived
from the iOS id by the app config, so there is no fourth value to keep in step.

**It does not work in Expo Go.** The sign in library ships native code, so the Go
client cannot load it. Build a development client. Google also refuses to
redirect to an `exp://` address, so the pure JavaScript route is shut there too.

## Deployment

| Target | Guide |
|---|---|
| Docker (primary) | below |
| Vercel Functions + Neon Postgres | [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) |
| Browser demo build | [docs/WEB_DEPLOY.md](docs/WEB_DEPLOY.md) |
| Android release | [docs/PLAY_STORE.md](docs/PLAY_STORE.md) |

### Docker

```bash
# backend/
docker build -t forkast-api .
docker run --env-file .env -p 8010:8010 forkast-api
```

The container applies pending migrations before starting uvicorn, so a deploy
that forgets to run alembic by hand never serves the old schema. Production
installs only `requirements.txt`; `requirements-dev.txt` (pytest, ruff, coverage)
is for local work and CI.

Production checklist:

- [ ] `ENVIRONMENT=production`
- [ ] A real `JWT_SECRET`, and `CORS_ORIGINS` narrowed from `*`
- [ ] `AI_PROVIDER=groq` with a key, if you want real estimates. Startup warns when
      production is backed by the local estimator
- [ ] `RESEND_API_KEY` and a verified sender domain
- [ ] `TRUST_PROXY_HEADERS=true` and the correct `TRUSTED_PROXY_HOPS`, only if a
      proxy you control sits in front
- [ ] At least one worker running
- [ ] The maintenance cron scheduled
- [ ] `/ready` returns 200 and `GET /queue` shows an empty dead-letter count

The mobile build for EAS never bakes a developer's LAN address into a committed
file. Set `EXPO_PUBLIC_API_URL` per machine with `eas env:create`, the same
pattern as the Google ids, or read it from `mobile/.env.local` for a run that
never leaves the machine.

### Jobs worker

Calorie refinement and the auth emails are rows in a `jobs` table, inserted in
the same transaction as the meal or token that needs them (see
`app/services/jobs.py`). The request runs its own job right behind its response;
the worker is what retries failures with exponential backoff and picks up
anything a restart interrupted. Run at least one, alongside the API:

```bash
python -m app.worker --concurrency 4   # or WORKER_CONCURRENCY
```

SIGTERM lets in-flight jobs finish and claims no more; a second SIGTERM puts the
unfinished ones straight back in the queue. Several workers can share one
database. `GET /queue` reports the pending backlog and the dead-letter count.

### Maintenance cron

Two tasks in `app/maintenance.py` are meant to run on a schedule:

```bash
# Stale rate-limit counters and expired refresh tokens. Cheap; hourly is fine.
0 * * * *      cd /app && python -m app.maintenance prune

# Re-queues refinement for logs the queue gave up on (dead-lettered) or never
# had (saved while the AI circuit breaker was open), with bounded concurrency so
# a large backlog does not fire an unbounded burst of calls at Groq.
*/15 * * * *   cd /app && python -m app.maintenance refine-backfill
```

Neither is wired into the Dockerfile's `CMD`: a container restarting is not a
cron tick, and running one inside the API process would tie its schedule to
uptime rather than wall-clock time. Point your platform's own cron (a Kubernetes
CronJob, Railway's cron, `cron(1)` beside the container) at these commands.

### App Links and Universal Links

Password reset and email verification links used to be bare `forkast://` links.
On Android any installed app can register for a custom scheme, and most mail
clients do not linkify one, so the link was both interceptable and often not
clickable. Set three variables and both platforms switch to `https://` links on
your own domain, with `forkast://` kept only as what the fallback web page
(`app/web.py`) hands off to.

```bash
# backend/.env
APP_DOMAIN=forkast.app
APPLE_APP_ID_PREFIX=<Apple Team ID, from App Store Connect > Membership>
ANDROID_SHA256_CERT_FINGERPRINT=<from `eas credentials`, or the Play Console's
                                   App signing key certificate>

# mobile/.env.local, or eas env:create for a build. Same domain, no scheme
EXPO_PUBLIC_APP_DOMAIN=forkast.app
```

`APP_DOMAIN` alone is not enough: the backend serves
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` as
404 until the matching Team ID or fingerprint is set too. A verification file
that names no real app is worse than none. All three empty, the default, is not a
partial setup; it is local development working as it always did.

None of this works unless those two files are served from `APP_DOMAIN` at its
real HTTPS origin, so the backend must be reachable there, behind a reverse proxy
or directly.

## Repository layout

```
backend/
  app/
    api/v1/          routes
    models/          SQLAlchemy models
    schemas/         request and response models
    services/        auth, calories, insights, jobs, rate limiting, circuit
                     breaker, and the AI seam (ai/)
    seed/            reference data and the demo seeder
    worker.py        jobs worker
    maintenance.py   scheduled housekeeping
    web.py           deep link fallback pages and .well-known files
  alembic/versions/  migrations
  scripts/           smoke.py, live_ai_check.py
  tests/
  Dockerfile
mobile/
  app/               Expo Router routes
  components/        UI primitives and screen pieces
  hooks/             TanStack Query hooks
  lib/               API client, token storage, types
  theme/             design tokens, light and dark
  __tests__/
docs/                deployment, accessibility, store and legal documents
.github/             CI workflow, issue and PR templates, Dependabot
```

## Design decisions

Worth knowing before you change things:

- **Closed vocabularies are varchar with a CHECK, never a native Postgres enum.**
  A native enum cannot drop a value and leaves the type behind on downgrade, so
  `downgrade base` then `upgrade head` fails with "type already exists".
- **Streaks are computed, never stored.** A stored counter is a second source of
  truth that drifts the moment a log is edited or deleted.
- **Days are the user's local days.** `users.timezone` drives the bucketing. In
  Karachi a UTC day rolls over at 5am local, so bucketing by UTC files a late
  dinner on the wrong day and makes both the chart and the streak quietly wrong.
- **The calorie clamp happens before the serving multiplier.** The model's job is
  only to place a dish inside its category range; a large portion may then exceed
  that range.
- **Side effects are queued transactionally.** A job row commits with the data
  that needs it, so a crash between "saved" and "emailed" cannot lose the email.
- **Fail at boot, not under attack.** A placeholder JWT secret, or `groq` with no
  key, stops the app from starting.
- **Every colour lives in `mobile/theme/tokens.ts`.** There are no hex literals
  anywhere else, so restyling never touches a screen.

## Troubleshooting

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

Find it with `ipconfig` (Windows) or `ip addr` / `ifconfig`. It is a DHCP lease,
so it changes when you rejoin the network. After editing it, do a full reload in
Expo Go; hot refresh will not pick it up. `curl http://<that ip>:8010/health`
from the phone's browser is the fastest way to confirm the path works.

**Windows firewall.** The phone cannot reach the laptop until the firewall allows
it, and if Windows has classified the network as Public then Private profile
rules do not apply. Check with `Get-NetConnectionProfile`, then in an elevated
shell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
New-NetFirewallRule -DisplayName "Forkast API" -Direction Inbound -LocalPort 8010 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Expo Metro"  -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private
```

**Expo Go sign in.** On SDK 57 you must sign in twice: `npx expo login` in the
terminal, and again inside the Expo Go app. A QR scan alone will fail.

**`pip install` fails on a wheel.** Intended. Check your Python version is 3.14
rather than letting pip compile from source.

**Tests refuse to start.** `TEST_DATABASE_URL` is unset or points at the same
database as `DATABASE_URL`. The suite truncates tables, so it refuses on purpose.

**Estimates never get "refined".** No worker is running, or the AI circuit
breaker is open. Check `GET /queue`.

**Migrations fail with "function uuidv7() does not exist".** You are on
PostgreSQL older than 18.

## Documentation

| Document | What it covers |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow and pre-PR checks |
| [SECURITY.md](SECURITY.md) | What the auth layer does, scope, and how to report a vulnerability |
| [DESIGN_STYLE_GUIDE.md](DESIGN_STYLE_GUIDE.md) | The rules every screen is composed against |
| [docs/A11Y.md](docs/A11Y.md) | Accessibility audit and manual device checks |
| [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) | Serverless deployment with Neon |
| [docs/WEB_DEPLOY.md](docs/WEB_DEPLOY.md) | Publishing the browser build |
| [docs/PLAY_STORE.md](docs/PLAY_STORE.md) | Release checklist |
| [docs/legal/](docs/legal) | Privacy policy, terms, refunds, tracking and store disclosures |

## Contributing and security

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first and run
the checks listed under [Testing](#testing); CI runs the same ones.

Please report vulnerabilities privately, following [SECURITY.md](SECURITY.md),
not in a public issue.

## License

Released under the [MIT License](LICENSE).
