---
name: Bug report
about: Something behaves differently from how it should
labels: bug
---

## What happened

## What you expected instead

## How to reproduce

1.
2.
3.

## Where

- [ ] Backend (FastAPI)
- [ ] App on Android
- [ ] App on iOS
- [ ] App in a browser

Expo Go or a development build?

## Versions

- Python / Node:
- PostgreSQL:
- `AI_PROVIDER`: fake or groq

## Anything the logs said

<!--
Two things to rule out first, because they account for most reports:

  - The API is on port 8010, not 8000. On Windows two processes can bind the
    same port, so the symptom is a response from the wrong server rather than an
    error.
  - `localhost` in mobile/.env.local does not work from a phone. Use your
    machine's LAN address and do a full reload, not a hot refresh.
-->
