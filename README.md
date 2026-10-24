# Forkast

[![CI](https://github.com/noorrbutt/Forkast/actions/workflows/ci.yml/badge.svg)](https://github.com/noorrbutt/Forkast/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Python](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)
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
- **Ramadan mode.** Opt-in sehri/iftar slots, a live fasting countdown, and a
  Ramadan-style meal plan, computed entirely on the device. See
  [docs/RAMADAN.md](docs/RAMADAN.md).

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
| Email | Brevo |
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
| Map | Real, except in Expo Go on Android. See [docs/MAP_SETUP.md](docs/MAP_SETUP.md) |

## Quick start

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.12+ | Via conda below. Production runs 3.12; CI also tests 3.14 |
| Node | 22.13 or newer | Expo SDK 57's floor. Enforced by `engines` and checked in CI |
| PostgreSQL | 18 | Needs `pg_trgm`, which ships with it. `uuidv7()` does not exist before 18 |
| conda | any | Only to create the environment |

### 1. Python environment

```bash
conda create -n forkast python=3.12 -y
conda activate forkast
pip install -r backend/requirements-dev.txt --only-binary :all:
```

`--only-binary :all:` is deliberate. It turns a missing wheel into a loud
failure instead of a silent source build that may or may not find a compiler.
The pins are exact for the same reason: SQLAlchemy is held at 2.0.53 because
2.0.54 shipped without a wheel for Python 3.14, which CI also runs against.
Use `requirements.txt` instead if you only want to run the server and not the
tests or linter.

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
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` | empty | Verification and reset emails. `EMAIL_FROM_NAME` defaults to `Forkast` |
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
| Food logs | `POST/GET /logs`, `GET/PATCH/DELETE /logs/{id}`, `POST /logs/estimate-photo`, `POST /logs/estimate-order`, `PUT/GET/DELETE /logs/{id}/photo` |
| Insights | `GET /dashboard`, `/streaks`, `/insights/reminder-signal`, `/insights/weekly-digest` |
| Plans | `POST/GET /plans`, `GET/DELETE /plans/{id}` |
| Burn | `PUT/GET /burn`, `GET /burn/today`, `DELETE /burn/{day}` |
| Catalog | `GET /cuisines`, `/categories`, `/search`, `/dishes`, `/restaurants`, `POST /restaurants` |
| Meta | `GET /health` (liveness), `/ready` (database up, AI status), `/queue` (job backlog, dead letters, breaker state) |

Authenticated routes take `Authorization: Bearer <access token>`. Every query is
scoped to the calling user.

## Testing

There are roughly 1,440 tests: about 650 on the backend and 790 on the app.

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

Real pins everywhere except Expo Go on Android, where it falls back to a list
grouped by area, and why no API key fixes that in Expo Go. See
[docs/MAP_SETUP.md](docs/MAP_SETUP.md).

### Continue with Google

Off unless configured: no client ids means no button, and `/auth/google`
answers 503. Setting it up needs three OAuth clients (Android, iOS, web) and
does not work inside Expo Go. See [docs/GOOGLE_SIGNIN.md](docs/GOOGLE_SIGNIN.md).

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
is for local work and CI. The image also drops root after installing
dependencies and runs as an unprivileged user.

That single `docker run` starts the API only. The jobs worker (below) is a
separate long-running process the same image can run with a different
command, and a deploy that skips it quietly loses retries and dead-letter
recovery -- `docker compose up --build` (`backend/docker-compose.yml`) starts
both the API and a worker from one build instead of the API alone.

Production checklist:

- [ ] `ENVIRONMENT=production`
- [ ] A real `JWT_SECRET`, and `CORS_ORIGINS` narrowed from `*`
- [ ] `AI_PROVIDER=groq` with a key, if you want real estimates. Startup warns when
      production is backed by the local estimator
- [ ] `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` (verified in Brevo, on an
      authenticated domain) and `APP_DOMAIN` -- startup refuses to boot with
      the first and no domain to link to
- [ ] `TRUST_PROXY_HEADERS=true` and the correct `TRUSTED_PROXY_HOPS`, only if a
      proxy you control sits in front
- [ ] At least one worker running
- [ ] The maintenance cron scheduled
- [ ] `METRICS_TOKEN` set, or `GET /queue` 404s (see its own docstring)
- [ ] `/ready` returns 200 and `GET /queue` (with the token) shows an empty
      dead-letter count

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

Three variables switch password reset and email verification from bare
`forkast://` links (interceptable on Android, often not even clickable from
mail) to `https://` links on your own domain. See
[docs/APP_LINKS.md](docs/APP_LINKS.md).

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

Port conflicts, `localhost` not reaching a phone, the Windows firewall, Expo Go
sign in, a `pip install` wheel failure, and a few more. See
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Documentation

| Document | What it covers |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow and pre-PR checks |
| [SECURITY.md](SECURITY.md) | What the auth layer does, scope, and how to report a vulnerability |
| [DESIGN_STYLE_GUIDE.md](docs/DESIGN_STYLE_GUIDE.md) | The rules every screen is composed against |
| [docs/A11Y.md](docs/A11Y.md) | Accessibility audit and manual device checks |
| [docs/RAMADAN.md](docs/RAMADAN.md) | Ramadan mode: how times are computed, privacy design, and known limits |
| [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) | Serverless deployment with Neon |
| [docs/WEB_DEPLOY.md](docs/WEB_DEPLOY.md) | Publishing the browser build |
| [docs/PLAY_STORE.md](docs/PLAY_STORE.md) | Release checklist |
| [docs/GOOGLE_SIGNIN.md](docs/GOOGLE_SIGNIN.md) | Setting up "Continue with Google" |
| [docs/MAP_SETUP.md](docs/MAP_SETUP.md) | Getting the real map working in a development build |
| [docs/APP_LINKS.md](docs/APP_LINKS.md) | `https://` deep links for reset and verification emails |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common local setup problems |
| [docs/legal/](docs/legal) | Privacy policy, terms, refunds, tracking and store disclosures |

## Contributing and security

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first and run
the checks listed under [Testing](#testing); CI runs the same ones.

Please report vulnerabilities privately, following [SECURITY.md](SECURITY.md),
not in a public issue.

## License

Released under the [MIT License](LICENSE).
