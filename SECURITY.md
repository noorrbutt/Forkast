# Security

## Reporting a vulnerability

Report privately, not in a public issue.

- GitHub: open a [private advisory](https://github.com/noorrbutt/Forkast/security/advisories/new)
- Or email: noorbbutt@gmail.com

Please include what you did, what happened, and what you expected. A request and
its response, or a short script, is worth more than a description.

This is a personal project with one maintainer, not a funded programme. Expect a
first reply within about a week. There is no bounty.

## Scope

Forkast stores what people ate, photographs of it, the areas they ate in, and
their timezone. That is a diary of someone's movements and habits, so anything
that lets one account read another's data is the most serious class of bug here,
ahead of availability.

Particularly interesting:

- Any read or write of another account's logs, photos, burn entries or plans
- Anything that mints, forges or extends a session, or survives a sign out
- Rate limit bypasses on `/auth/login`, `/auth/register`, `/auth/refresh` or
  `/plans` (the last one costs real money when Groq is enabled)
- Injection through the search term, a dish name, a restaurant name or an
  uploaded image
- Anything that makes the server buffer or store an unbounded amount

Out of scope:

- The demo account (`demo@forkast.app`) and its seeded data. It is published in
  the README on purpose.
- Missing hardening on a development configuration: `CORS_ORIGINS=*`,
  `/docs` being served, and `ENVIRONMENT=dev` are dev defaults. Production
  refuses to start with a wildcard CORS origin.
- Denial of service by sheer volume against someone's own laptop.

## What the application already does

Stated so a report can say which of these failed rather than proposing one that
is there.

- **Passwords** are Argon2 via `pwdlib`, hashed on a worker thread so a login
  cannot stall the event loop. An unknown address is compared against a real
  dummy hash so it costs the same time as a known one.
- **Access tokens** are short-lived JWTs carrying a session id. Every request
  joins against a live refresh token for that session, so signing out stops the
  access token immediately rather than up to half an hour later.
- **Refresh tokens** are opaque, stored only as a SHA-256 hash, and rotated on
  every use by a single conditional `UPDATE`, so two concurrent uses cannot both
  win. Replaying a spent token revokes every live token on the account
  (RFC 9700 §4.14.2).
- **Rate limits** are counted in PostgreSQL, not in a per-process dict, and are
  keyed per address, per peer, and per account depending on what the route is
  protecting. `X-Forwarded-For` is only consulted when `TRUST_PROXY_HEADERS` is
  set, and is then read from the right, because proxies append and the leftmost
  entry is whatever the caller sent.
- **Uploads** are checked by magic bytes rather than the declared content type,
  and capped both by a body-size limit in ASGI middleware and by a database
  CHECK constraint.
- **Configuration** is validated at import: a placeholder or short `JWT_SECRET`,
  a non-HMAC JWT algorithm, `AI_PROVIDER=groq` without a key, or production with
  wildcard CORS all refuse to boot.
- **Every log, photo and plan query** filters on the authenticated user, and
  answers 404 rather than 403 for another account's id so the id's existence is
  not confirmed.

## What it does not do

Known and accepted, so please do not report these as findings. Arguments that
one of them matters more than assumed are welcome.

- **No email verification**, so registration answers 409 for an address that
  already exists and is therefore an account-existence oracle. The per-peer
  registration limit is what stops it being run against a list.
- **No MFA, no password breach check, no account lockout.** The password floor
  is 8 characters.
- **Photos are stored as bytes in PostgreSQL with no per-account quota.** A
  determined user can grow the database.
- **No audit log** of authentication events.
- **HTTPS is assumed to be terminated by a proxy.** The app sends HSTS only when
  the request actually arrived over TLS.
