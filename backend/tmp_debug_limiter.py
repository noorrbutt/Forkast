import asyncio
from sqlalchemy import text
from app.services.rate_limit import RateLimiter
from app.db import SessionLocal

async def main():
    limiter = RateLimiter(SessionLocal)
    for i in range(5):
        try:
            await limiter.hit('register', 'debug-peer', limit=3, window_seconds=300)
            print('hit ok', i)
        except Exception as exc:
            print('hit raised', i, type(exc).__name__, exc)
    async with SessionLocal() as db:
        rows = await db.execute(text('SELECT bucket, identity, count FROM rate_limit_counters WHERE bucket = :bucket ORDER BY count'), {'bucket': 'register'})
        print('rows', rows.fetchall())

asyncio.run(main())
