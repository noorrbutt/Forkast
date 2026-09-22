import asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.api.v1 import auth as auth_mod
from app.services import rate_limit
from app.db import SessionLocal
from sqlalchemy import select, text

async def main():
    from app.config import get_settings
    from tests.conftest import _truncate_if_present

    await _truncate_if_present()
    print('register rate', get_settings().register_rate_limit)

    def wrapped(request, *, subject=None):
        value = rate_limit.client_identity(request, subject=subject)
        print('identity=', value, 'client=', request.client, 'subject=', subject)
        return value

    auth_mod.client_identity = wrapped

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver') as client:
        for i in range(250):
            resp = await client.post('/api/v1/auth/register', json={
                'first_name': 'Test',
                'last_name': 'User',
                'email': f'probe{i}@forkast.app',
                'password': 'password123',
            })
            if resp.status_code == 429 or i % 25 == 0:
                print('status', i, resp.status_code, resp.text[:90])
            if i in (119, 120, 121, 122):
                async with SessionLocal() as db:
                    rows = (await db.execute(text('SELECT identity, count FROM rate_limit_counters WHERE bucket = :bucket ORDER BY count DESC'), {'bucket': 'register'})).fetchall()
                    print('counter rows near limit', rows[:10])

asyncio.run(main())
