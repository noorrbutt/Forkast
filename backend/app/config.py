"""Application settings, loaded from backend/.env via pydantic-settings."""

from __future__ import annotations

import enum
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class AIProvider(str, enum.Enum):
    """Which AI implementation backs the calorie and plan seams.

    An enum rather than a bool so a typo fails loudly at startup and a third
    implementation can be added without changing the flag's shape.
    """

    fake = "fake"
    groq = "groq"


class Environment(str, enum.Enum):
    """Which deployment this is. Controls only things that must differ between
    a laptop and a public host, never business behaviour."""

    dev = "dev"
    production = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Environment = Field(default=Environment.dev, alias="ENVIRONMENT")

    database_url: str = Field(alias="DATABASE_URL")
    test_database_url: str = Field(alias="TEST_DATABASE_URL")

    jwt_secret: SecretStr = Field(alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=30, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=30, alias="REFRESH_TOKEN_EXPIRE_DAYS")

    default_timezone: str = Field(default="Asia/Karachi", alias="DEFAULT_TIMEZONE")

    ai_provider: AIProvider = Field(default=AIProvider.fake, alias="AI_PROVIDER")
    groq_api_key: SecretStr | None = Field(default=None, alias="GROQ_API_KEY")
    groq_model: str = Field(default="openai/gpt-oss-20b", alias="GROQ_MODEL")

    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")

    # Whether X-Forwarded-For may be believed when identifying a caller. Off by
    # default: with no proxy in front, any caller can set the header and hand
    # themselves a fresh rate-limit identity on every request. Turn it on only
    # when something trustworthy is actually rewriting it.
    trust_proxy_headers: bool = Field(default=False, alias="TRUST_PROXY_HEADERS")

    # Largest request body the API will read, in bytes. The log and plan
    # payloads are a few hundred bytes; a megabyte is already absurd for them.
    # Without a cap, an unauthenticated caller can make the server buffer as
    # much as it is willing to send.
    max_request_bytes: int = Field(default=1_048_576, alias="MAX_REQUEST_BYTES")

    # Login attempts allowed per window for one address from one peer. Generous
    # enough that a person fat-fingering a password never notices, tight enough
    # that a password list is not worth running.
    login_rate_limit: int = Field(default=10, alias="LOGIN_RATE_LIMIT")
    # And per peer across all addresses, which is what catches a spray that
    # tries one password against a thousand accounts and so never spends any
    # single account's allowance. Much higher, because a whole office behind one
    # NAT address shares it.
    login_peer_rate_limit: int = Field(default=50, alias="LOGIN_PEER_RATE_LIMIT")
    # Registration is counted per peer only. The point of limiting it is that
    # 409-on-duplicate is an account existence oracle, and walking a list uses a
    # different address every time, so a per-address key would never trip. Real
    # people register approximately once.
    register_rate_limit: int = Field(default=5, alias="REGISTER_RATE_LIMIT")
    login_rate_window_seconds: int = Field(default=300, alias="LOGIN_RATE_WINDOW_SECONDS")

    # Plans are the only route that costs real money once Groq is behind it.
    plan_rate_limit: int = Field(default=20, alias="PLAN_RATE_LIMIT")
    plan_rate_window_seconds: int = Field(default=3600, alias="PLAN_RATE_WINDOW_SECONDS")

    @property
    def docs_enabled(self) -> bool:
        """The interactive docs enumerate every route and schema. Fine on a
        laptop, free reconnaissance on a public host."""
        return self.environment is not Environment.production

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sync_database_url(self) -> str:
        """Alembic's offline/sync path needs a non-async driver URL."""
        return self.database_url.replace("+asyncpg", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
