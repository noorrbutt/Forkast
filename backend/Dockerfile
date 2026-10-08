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

# Root by default is root's whole filesystem, not a mistake this image needs
# to make: a code-execution bug in a dependency only has to compromise a
# process that owns nothing on the host. Owns /app only -- nothing is written
# outside it at runtime -- which is all a stray RUN before this point would
# have needed root for anyway.
RUN useradd --system --no-create-home --uid 10001 forkast \
    && chown -R forkast:forkast /app
USER forkast

EXPOSE 8010

# Migrations run before the server starts, not as a separate manual step, so
# a deploy that forgets to run alembic by hand never quietly serves the old
# schema against a newer one.
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8010 --workers 2
