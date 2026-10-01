"""Calorie refinement as a queued job rather than a BackgroundTask.

The point of the change is that the job is written by the same commit as the
meal: a meal that saved always has its refinement queued, a save that failed
never leaves a stray job behind, and a restart between the response and the
refinement no longer loses it. And since a job can run more than once, running
the same refinement twice has to land on the same row state as running it once.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodLog, Job
from app.models.enums import JobStatus
from app.services import jobs
from app.services.ai.fake import DeterministicAIService
from app.services.logs import refine_estimate

LOGS = "/api/v1/logs"


async def _a_category(client: AsyncClient, slug: str = "biryani") -> dict:
    categories = (await client.get("/api/v1/categories")).json()
    return next(c for c in categories if c["slug"] == slug)


async def _refine_jobs(session: AsyncSession) -> list[Job]:
    session.expire_all()
    return list(await session.scalars(select(Job).where(Job.kind == jobs.REFINE_CALORIE_ESTIMATE)))


async def test_saving_a_meal_queues_its_refinement_and_runs_it(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    category = await _a_category(auth_client)
    created = await auth_client.post(
        LOGS,
        json={
            "dish_name": "haleem",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
        },
    )
    assert created.status_code == 201, created.text

    [job] = await _refine_jobs(session)
    assert job.payload == {"log_id": created.json()["id"], "category_id": category["id"]}
    # Run behind the response by the request itself, as the BackgroundTask was.
    assert job.status is JobStatus.done
    assert (await auth_client.get(f"{LOGS}/{created.json()['id']}")).json()["refined"] is True


async def test_a_save_that_fails_leaves_no_job_behind(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    response = await auth_client.post(
        LOGS,
        json={"dish_name": "ghost", "category_id": 32000, "rating": 4, "serving_size": "medium"},
    )
    assert response.status_code == 422
    assert await _refine_jobs(session) == []
    assert await session.scalar(select(FoodLog.id)) is None


async def test_a_photo_priced_meal_queues_nothing(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    category = await _a_category(auth_client)
    response = await auth_client.post(
        LOGS,
        json={
            "dish_name": "plate",
            "category_id": category["id"],
            "rating": 4,
            "serving_size": "medium",
            "estimated_calories": category["base_calorie_min"],
        },
    )
    assert response.status_code == 201, response.text
    assert await _refine_jobs(session) == []


async def test_an_edit_to_the_estimate_inputs_queues_a_fresh_refinement(
    auth_client: AsyncClient, session: AsyncSession
) -> None:
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "nihari",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "small",
            },
        )
    ).json()

    await auth_client.patch(f"{LOGS}/{created['id']}", json={"rating": 2})
    assert len(await _refine_jobs(session)) == 1

    await auth_client.patch(f"{LOGS}/{created['id']}", json={"serving_size": "large"})
    assert len(await _refine_jobs(session)) == 2


async def test_running_the_same_refinement_twice_converges(
    auth_client: AsyncClient, session: AsyncSession, session_factory
) -> None:
    """A worker that commits the refined figure and dies before marking the
    job done gets the job run again. The second run must not refine twice."""
    category = await _a_category(auth_client)
    created = (
        await auth_client.post(
            LOGS,
            json={
                "dish_name": "karahi",
                "category_id": category["id"],
                "rating": 4,
                "serving_size": "medium",
            },
        )
    ).json()
    log_id = uuid.UUID(created["id"])
    settled = await session.get(FoodLog, log_id)
    assert settled is not None and settled.estimate_refined_at is not None
    figure, refined_at = settled.estimated_calories, settled.estimate_refined_at

    # The job ran (and was marked done) behind the response. Put it back as if
    # that last step never happened, and let it run again.
    [job] = await _refine_jobs(session)
    await session.execute(
        update(Job).where(Job.id == job.id).values(status=JobStatus.pending, locked_at=None)
    )
    await session.commit()

    await jobs.run_now(
        job.id, jobs.JobContext(factory=session_factory, ai=DeterministicAIService())
    )
    assert (
        await refine_estimate(log_id, category["id"], DeterministicAIService(), session_factory)
        is False
    )

    session.expire_all()
    again = await session.get(FoodLog, log_id)
    assert again is not None
    assert again.estimated_calories == figure
    assert again.estimate_refined_at == refined_at
    assert (await _refine_jobs(session))[0].status is JobStatus.done
