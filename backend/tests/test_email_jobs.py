"""Auth emails as queued jobs rather than BackgroundTasks.

Before, a provider failure was logged and the email was simply gone: the user
waited for a link that never came and had to ask again. Now the send is a job
committed with the token it carries, so a failure is retried on a backoff, and
the raw token is wiped from the row once the job is finished either way.
"""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job
from app.models.enums import JobStatus
from app.services import email as email_service
from app.services import jobs

REGISTER = "/api/v1/auth/register"


def _mock_resend(monkeypatch: pytest.MonkeyPatch, *, side_effect=None) -> Mock:
    send = Mock(side_effect=side_effect)
    client = SimpleNamespace(Emails=SimpleNamespace(send=send))
    settings = SimpleNamespace(
        resend_api_key=SecretStr("re_test_key"),
        resend_from_email="Forkast <noreply@example.test>",
    )
    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(email_service, "init_resend_client", lambda: client)
    return send


async def _email_job(session: AsyncSession) -> Job:
    session.expire_all()
    job = await session.scalar(select(Job).where(Job.kind == jobs.SEND_EMAIL))
    assert job is not None
    return job


async def test_a_failed_verification_email_is_retried_and_then_scrubbed(
    client: AsyncClient,
    session: AsyncSession,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failing = _mock_resend(monkeypatch, side_effect=RuntimeError("provider unavailable"))
    response = await client.post(
        REGISTER,
        json={
            "first_name": "Test",
            "last_name": "User",
            "email": "retry-me@forkast.app",
            "password": "password123",
        },
    )
    assert response.status_code == 201, response.text
    assert failing.call_count == 1

    job = await _email_job(session)
    assert job.status is JobStatus.pending
    assert job.attempts == 1
    assert "provider unavailable" in (job.last_error or "")
    assert job.payload["to"] == "retry-me@forkast.app"
    link = job.payload["link"]

    # The provider recovers and the backoff has elapsed.
    working = _mock_resend(monkeypatch)
    await session.execute(
        update(Job).where(Job.id == job.id).values(run_at=dt.datetime.now(dt.UTC))
    )
    await session.commit()
    [claimed] = await jobs.claim(session_factory)
    await jobs.run_claimed(claimed, jobs.JobContext(factory=session_factory))

    assert working.call_count == 1
    assert link in working.call_args.args[0]["text"]
    done = await _email_job(session)
    assert done.status is JobStatus.done
    # The link holds a live one-time token; only its hash belongs in the DB.
    assert done.payload == {}


async def test_an_email_change_that_conflicts_queues_no_email(
    auth_client: AsyncClient, client: AsyncClient, session: AsyncSession
) -> None:
    """The token and its email commit together, so a change refused at the
    uniqueness check leaves neither behind."""
    taken = await client.post(
        REGISTER,
        json={
            "first_name": "Other",
            "last_name": "User",
            "email": "taken@forkast.app",
            "password": "password123",
        },
    )
    assert taken.status_code == 201
    session.expire_all()
    before = len(list(await session.scalars(select(Job).where(Job.kind == jobs.SEND_EMAIL))))

    response = await auth_client.patch("/api/v1/me", json={"email": "taken@forkast.app"})

    assert response.status_code == 409
    session.expire_all()
    after = len(list(await session.scalars(select(Job).where(Job.kind == jobs.SEND_EMAIL))))
    assert after == before
