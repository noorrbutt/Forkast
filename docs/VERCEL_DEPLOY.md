# Deploying the API to Vercel with Neon Postgres

The Docker image (`backend/Dockerfile`) is still the primary deployment and is
unchanged. This is an additional path: the FastAPI app in `backend/` running as
a Vercel Python Function, against a Neon Postgres database.

## What is different on serverless

A Vercel Function's process can be frozen or killed the moment a response is
sent, and there is no long-lived process. `SERVERLESS=true` adapts the API to
that:

- **Jobs a request commits run inline.** Calorie refinement on `POST /logs` and
  `PATCH /logs/{id}`, and the emails from register, resend-verification,
  forgot-password and an email change on `PATCH /me`, are awaited before the
  response returns instead of scheduled behind it. Each is bounded by
  `SERVERLESS_JOB_TIMEOUT_SECONDS` (default 8). A failure or timeout never
  fails the request: the log is already saved with its provisional estimate,
  the account or reset request already exists, and the job is put back to
  `pending` (with the usual backoff) for a worker to retry.
  - Trade-off: on serverless, forgot-password and resend-verification answer
    measurably slower for an address that has an account, because the email is
    sent inside the request. The rate limits on those routes still apply.
- **No startup AI probe.** `/ready` reports `"ai": "not_probed"`. Refinement
  already degrades to the provisional figure, and the circuit breaker (on
  `GET /queue`) tracks real failures.
- **NullPool.** SQLAlchemy opens a connection per checkout and closes it on
  return; Neon's pooler does the pooling.

## The worker still has to run somewhere

`python -m app.worker` needs a long-lived process. Vercel Functions are not
that. With `SERVERLESS=true` the API does not *depend* on the worker for the
happy path, but anything that failed or timed out inline is only retried by a
worker, and dead letters and `refine-backfill` (`python -m app.maintenance`)
need it too. Run it against the same Neon database on something long-lived:

- the existing Docker image with the command overridden, e.g.
  `docker run --env-file .env forkast-api python -m app.worker`
- a small VM, Railway, Fly.io, Render background worker, etc.
- or, at minimum, periodic manual runs: `python -m app.worker` until the queue
  drains, then `python -m app.maintenance refine-backfill`.

Leave `SERVERLESS` unset (false) on the worker. Watch `GET /queue` for a
growing `pending` or any `dead_letter`.

## 1. Neon

Create a project and copy two connection strings from the Neon console:

- **Pooled** (host contains `-pooler`), for the Vercel deployment:
  `postgresql://USER:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/DBNAME?sslmode=require`
- **Direct** (no `-pooler`), for running migrations.

Paste either as-is, including `sslmode=require` and `channel_binding=require` if
Neon includes it. `app/config.py` rewrites the URL for asyncpg: the scheme
becomes `postgresql+asyncpg`, `sslmode` becomes asyncpg's `ssl`, and
`channel_binding` (which asyncpg does not accept) is dropped.

`pg_trgm` is created by the first migration with
`CREATE EXTENSION IF NOT EXISTS pg_trgm`; Neon allows that for its default
role, so nothing has to be done by hand.

Prepared statements through the pooler: asyncpg uses them, and Neon's pooler
supports them. If you ever see `prepared statement "..." does not exist`
errors, use the direct (non-pooler) URL for `DATABASE_URL` instead.

## 2. Run the migrations against Neon

Run them from your machine (or CI), not from Vercel. The Docker image runs
`alembic upgrade head` on start; a Vercel Function has no start step, and the
build step must not touch the database (a build failure would then leave the
schema half-migrated, and preview builds would migrate production).

From `backend/`, with your normal dev setup, point `DATABASE_URL` at Neon's
**direct** URL just for this command:

```sh
# bash
DATABASE_URL='postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/DBNAME?sslmode=require' \
  python -m alembic upgrade head
```

```powershell
# PowerShell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/DBNAME?sslmode=require'
python -m alembic upgrade head
Remove-Item Env:DATABASE_URL
```

An environment variable overrides `backend/.env`, so the rest of your `.env`
(JWT_SECRET, ...) still satisfies `Settings`. If
`CORS_ORIGINS` is `*` in your `.env`, set it to a real origin for this command
too: `Settings` refuses `*` with a non-local database. Run this again before
every deploy that adds a migration, and deploy the code after.

Reference data (cuisines, food categories) is loaded by migration 0002, so
`upgrade head` is all a new database needs. Do not run `python -m app.seed.run`
against production; it creates a demo account.

## 3. Vercel project

This repo is a monorepo (`mobile/` and `backend/` at the top level). Create a
Vercel project from the repo and, under **Settings > Build and Deployment**:

- **Root Directory:** `backend`. Everything below is relative to it:
  `backend/requirements.txt` is the dependency file Vercel installs,
  `backend/vercel.json` is the config it reads, and `backend/api/index.py` is
  the function. No top-level `vercel.json` is needed.
- **Framework Preset:** Other.
- Leave the build and install commands at their defaults.

Python version: `backend/.python-version` pins **3.12**, which matches the
Dockerfile (`python:3.12-slim`) and is Vercel's default Python version
(3.12, 3.13 and 3.14 are supported). Vercel reads `.python-version`; there is no
`runtime` field to set in `vercel.json` for Python any more.

`backend/vercel.json` rewrites every path to `api/index.py`, which imports
`app` from `app.main`, and gives the function `maxDuration: 60`. It also
keeps `tests/` and `scripts/` out of the bundle.

## 4. Environment variables (Vercel > Settings > Environment Variables)

Required:

| Name | Value |
| --- | --- |
| `SERVERLESS` | `true` |
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | Neon **pooled** URL |
| `JWT_SECRET` | `openssl rand -hex 32`. At least 32 characters. |
| `CORS_ORIGINS` | The real origin(s), comma separated. `*` is refused in production. |
| `TRUST_PROXY_HEADERS` | `true`. Must be set explicitly in production; Vercel's edge sets `X-Forwarded-For`. |

AI:

| Name | Value |
| --- | --- |
| `AI_PROVIDER` | `groq` or `fake` (default `fake`) |
| `GROQ_API_KEY` | Required when `AI_PROVIDER=groq` |
| `GROQ_MODEL` | Optional, default `openai/gpt-oss-20b` |
| `PHOTO_ESTIMATE_ENABLED` | Optional kill switch, default `true` |

Email (both or neither):

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend key |
| `RESEND_FROM_EMAIL` | Verified sender |

Optional, with their defaults in `backend/app/config.py`:

- `SERVERLESS_JOB_TIMEOUT_SECONDS` (8). Keep it well under `maxDuration`.
- `TRUSTED_PROXY_HOPS` (1)
- `APP_DOMAIN`, `APPLE_APP_ID_PREFIX`, `ANDROID_SHA256_CERT_FINGERPRINT`
- `GOOGLE_CLIENT_IDS`
- `DEFAULT_TIMEZONE`
- `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`,
  `REFRESH_REUSE_LEEWAY_SECONDS`
- rate limits: `REFINE_RATE_LIMIT`, `LOG_DAILY_LIMIT`, `PHOTO_DAILY_LIMIT`,
  `PHOTO_ESTIMATE_DAILY_LIMIT`, `RESTAURANT_DAILY_LIMIT`, `LOGIN_RATE_LIMIT`,
  `LOGIN_PEER_RATE_LIMIT`, `REFRESH_RATE_LIMIT`, `REGISTER_RATE_LIMIT`,
  `LOGIN_RATE_WINDOW_SECONDS`, `PLAN_RATE_LIMIT`, `PLAN_RATE_WINDOW_SECONDS`,
  `PHOTO_ESTIMATE_RATE_LIMIT`, `PHOTO_ESTIMATE_RATE_WINDOW_SECONDS`
- `MAX_REQUEST_BYTES`. Vercel caps request bodies at 4.5 MB regardless.
- `JOB_MAX_ATTEMPTS`, `JOB_BACKOFF_BASE_SECONDS`, `JOB_BACKOFF_MAX_SECONDS`,
  `JOB_STALE_SECONDS`, `AI_BREAKER_THRESHOLD`, `AI_BREAKER_COOLDOWN_SECONDS`
- `ARGON2_TIME_COST`, `ARGON2_MEMORY_COST`, `ARGON2_PARALLELISM`,
  `LOGIN_TIMING_PAD_SECONDS`

`WORKER_CONCURRENCY` and `WORKER_POLL_SECONDS` only matter on the worker.

## 5. Deploy and check

Push (or `vercel --prod` from `backend/`), then:

```sh
curl https://YOUR-PROJECT.vercel.app/health
curl https://YOUR-PROJECT.vercel.app/ready     # "ai": "not_probed" on groq is expected
curl https://YOUR-PROJECT.vercel.app/queue
cd backend
python -m scripts.smoke --base-url https://YOUR-PROJECT.vercel.app
python -m scripts.live_ai_check --base-url https://YOUR-PROJECT.vercel.app   # only with AI_PROVIDER=groq
```

`/docs` is off in production, as on Docker.
