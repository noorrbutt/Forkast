"""FastAPI dependency that resolves the configured AI implementation."""

from __future__ import annotations

from functools import lru_cache

from app.config import AIProvider, get_settings
from app.services.ai.base import AIService
from app.services.ai.fake import DeterministicAIService
from app.services.ai.groq_service import GroqAIService


@lru_cache
def _build_ai_service() -> AIService:
    settings = get_settings()
    if settings.ai_provider is AIProvider.groq:
        if not settings.groq_api_key or not settings.groq_api_key.get_secret_value():
            raise RuntimeError("AI_PROVIDER is groq but GROQ_API_KEY is empty")
        from groq import AsyncGroq

        client = AsyncGroq(api_key=settings.groq_api_key.get_secret_value())
        return GroqAIService(client, model=settings.groq_model)
    return DeterministicAIService()


def get_ai_service() -> AIService:
    """Routes depend on this. Tests swap it via app.dependency_overrides."""
    return _build_ai_service()
