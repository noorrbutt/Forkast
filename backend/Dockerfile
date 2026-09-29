# Runtime only: requirements.txt, never requirements-dev.txt (pytest, ruff,
# coverage have no business in a production image).
FROM python:3.12-slim

WORKDIR /app

# libpq for psycopg; asyncpg is pure C extension wheels and needs nothing extra.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8010

# Migrations run before the server starts, not as a separate manual step, so
# a deploy that forgets to run alembic by hand never quietly serves the old
# schema against a newer one.
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8010 --workers 2
