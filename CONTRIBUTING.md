# Contributing

## Getting it running

[README.md](README.md) has the full setup. The short version, once PostgreSQL 18
and Node 22.13 are installed:

```bash
conda create -n forkast python=3.14 -y && conda activate forkast
pip install -r backend/requirements.txt --only-binary :all:
createdb -U postgres forkast && createdb -U postgres forkast_test
cp backend/.env.example backend/.env    # then set the URLs and a JWT secret
cd backend && alembic upgrade head && python -m app.seed.run
cd ../mobile && npm install
```

The app refuses to start with a `JWT_SECRET` that is still the placeholder, or
with `AI_PROVIDER=groq` and no key. Both are deliberate: a configuration that is
wrong in a way you would only discover under attack should fail at boot.

## Before you open a pull request

Everything CI runs, you can run:

```bash
cd backend
ruff check . && ruff format --check .
alembic check                  # models and migrations have not drifted
pytest                         # against forkast_test, never forkast

cd ../mobile
npm run lint
npm run typecheck
npx jest
```

CI runs exactly these on every pull request. If it is green locally it should be
green there; if it is not, that difference is a bug worth reporting.

The backend suite takes around fifteen minutes because it runs the real
migrations against a real database rather than mocking either. That is the point
of it: every run re-proves that `alembic upgrade head` works on an empty
database, which a mocked suite cannot tell you.

## What a good change looks like

**One commit per coherent unit.** Models, migrations, a route, a screen. Not
"various fixes". The history is the main documentation of why this code is
shaped the way it is, so it is worth keeping legible.

**Say why, not what.** The diff already says what changed. A commit message and
a comment are for the reasoning that is not recoverable from the code: what you
tried, what broke, why the obvious approach does not work. Most of the comments
in this codebase are that, and they are the reason it is maintainable.

**A bug fix comes with the test that fails without it.** Not a test that
exercises the area; one that actually fails on the code as it was. There is a
worked example in [backend/tests/test_audit_fixes.py](backend/tests/test_audit_fixes.py):
each test there names the bug it pins and why the existing suite could not see
it.

**No new hex colours.** Every colour lives in
[mobile/theme/tokens.ts](mobile/theme/tokens.ts) and a test enforces that there
are none anywhere else, so restyling never has to touch a screen.

## Things that will surprise you

These are the ones that have cost real time. The README explains each in full.

- **The API is on port 8010, not 8000.** On Windows two processes can bind the
  same port, so the symptom is your requests being answered by a different
  server rather than a bind error.
- **`localhost` does not work from a phone.** Expo Go runs on the handset, where
  localhost is the handset. Put your machine's LAN address in
  `mobile/.env.local` and do a full reload; hot refresh will not pick it up.
- **Only `EXPO_PUBLIC_API_URL` may carry that prefix.** Expo inlines
  `EXPO_PUBLIC_` values into the shipped bundle in plaintext. A secret behind
  that prefix is a published secret.
- **The map is a list on Android under Expo Go.** Expo removed Google Maps from
  the Go client in SDK 53 and Google is the only provider `react-native-maps`
  has there. It needs a development build, not an API key.
- **Days are the user's local days**, driven by `users.timezone`. Bucketing by
  UTC files a late dinner on the wrong day and makes both the chart and the
  streak quietly wrong.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
