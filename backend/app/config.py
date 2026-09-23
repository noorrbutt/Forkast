"""Application settings, loaded from backend/.env via pydantic-settings."""

from __future__ import annotations

import enum
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, SecretStr, model_validator
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


def _rewrite_database_url(raw_url: str, *, async_driver: bool) -> str:
    parsed = urlsplit(raw_url)
    scheme = parsed.scheme.lower()
    if scheme in {"postgres", "postgresql"}:
        scheme = "postgresql+asyncpg" if async_driver else "postgresql+psycopg"
    elif scheme in {"postgresql+asyncpg", "postgresql+psycopg"}:
        scheme = "postgresql+asyncpg" if async_driver else "postgresql+psycopg"

    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if async_driver:
        sslmode = params.pop("sslmode", None)
        if sslmode is not None and "ssl" not in params:
            params["ssl"] = sslmode
    else:
        ssl = params.pop("ssl", None)
        if ssl is not None and "sslmode" not in params:
            params["sslmode"] = ssl

    rebuilt = urlencode(params, doseq=True)
    return urlunsplit((scheme, parsed.netloc, parsed.path, rebuilt, ""))


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
    refresh_reuse_leeway_seconds: int = Field(default=30, alias="REFRESH_REUSE_LEEWAY_SECONDS")
    refine_rate_limit: int = Field(default=60, alias="REFINE_RATE_LIMIT")
    log_daily_limit: int = Field(default=300, alias="LOG_DAILY_LIMIT")
    photo_daily_limit: int = Field(default=100, alias="PHOTO_DAILY_LIMIT")
    restaurant_daily_limit: int = Field(default=20, alias="RESTAURANT_DAILY_LIMIT")

    default_timezone: str = Field(default="Asia/Karachi", alias="DEFAULT_TIMEZONE")

    ai_provider: AIProvider = Field(default=AIProvider.fake, alias="AI_PROVIDER")
    groq_api_key: SecretStr | None = Field(default=None, alias="GROQ_API_KEY")
    groq_model: str = Field(default="openai/gpt-oss-20b", alias="GROQ_MODEL")

    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")

    # Every OAuth client id that may appear in the `aud` claim of a Google ID
    # token this API will accept, comma separated. There is one per platform --
    # iOS, Android and Web all get their own from the Google Cloud console --
    # and the token the phone sends carries whichever one asked for it, so all
    # of them have to be listed or sign in works on two platforms and not the
    # third.
    #
    # NOT a secret, and deliberately not a SecretStr. An OAuth client id for a
    # native app is public by design: it ships inside the bundle, anyone can
    # read it out, and Google's own docs say so. What makes it safe is that the
    # `aud` check below refuses a token minted for anybody else's client.
    #
    # Empty by default, which turns "Continue with Google" off rather than
    # leaving it half on. See google_enabled.
    google_client_ids: str = Field(default="", alias="GOOGLE_CLIENT_IDS")

    # Whether X-Forwarded-For may be believed when identifying a caller. Off by
    # default: with no proxy in front, any caller can set the header and hand
    # themselves a fresh rate-limit identity on every request. Turn it on only
    # when something trustworthy is actually rewriting it.
    trust_proxy_headers: bool = Field(default=False, alias="TRUST_PROXY_HEADERS")

    # How many proxies actually sit in front of this app. X-Forwarded-For is
    # read this many hops in from the right, because proxies append and only the
    # rightmost entries were written by something we control. One is correct for
    # a single nginx or a single load balancer; behind Cloudflare in front of a
    # load balancer it is two. Setting it too high walks left into
    # caller-supplied text, so it is bounded rather than free.
    trusted_proxy_hops: int = Field(default=1, ge=1, le=8, alias="TRUSTED_PROXY_HOPS")

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
    # Refresh is a different shape from login: a single mobile carrier or office
    # can share one peer behind CGNAT, and a user may legitimately rotate many
    # refresh tokens during a single active session. The limit therefore sits on
    # its own bucket rather than inheriting the login peer allowance.
    refresh_rate_limit: int = Field(default=300, alias="REFRESH_RATE_LIMIT")
    # Registration is counted per peer only. The point of limiting it is that
    # 409-on-duplicate is an account existence oracle, and walking a list uses a
    # different address every time, so a per-address key would never trip. Real
    # people register approximately once, but a legitimate burst of a few dozen
    # signups in a short span is still common during onboarding tests and
    # product launches. The cap is therefore higher than the login limiter so it
    # does not block normal account creation while still throttling automation.
    register_rate_limit: int = Field(default=120, alias="REGISTER_RATE_LIMIT")
    login_rate_window_seconds: int = Field(default=300, alias="LOGIN_RATE_WINDOW_SECONDS")

    # Plans are the only route that costs real money once Groq is behind it.
    plan_rate_limit: int = Field(default=20, alias="PLAN_RATE_LIMIT")
    plan_rate_window_seconds: int = Field(default=3600, alias="PLAN_RATE_WINDOW_SECONDS")

    # Argon2id cost parameters, matching argon2-cffi's own OWASP-aligned
    # defaults (t=3, m=64 MiB, p=4). Overridable rather than hardcoded in
    # security.py so the test suite can ask for a cheap, single-threaded
    # hasher without touching production behaviour. This matters for two
    # separate reasons: a real Argon2 hash costs ~100ms, and hundreds of them
    # in a burst test add up to real wall-clock minutes; and parallelism > 1
    # makes argon2-cffi spin up its own worker threads per hash, which -- run
    # from inside an anyio worker thread that a request handler is already
    # blocking on -- has been the source of hangs on Windows. Tests set
    # ARGON2_TIME_COST=1, ARGON2_MEMORY_COST small, and ARGON2_PARALLELISM=1
    # (see tests/conftest.py) to avoid both problems at once.
    argon2_time_cost: int = Field(default=3, alias="ARGON2_TIME_COST")
    argon2_memory_cost: int = Field(default=65536, alias="ARGON2_MEMORY_COST")
    argon2_parallelism: int = Field(default=4, alias="ARGON2_PARALLELISM")

    # How long, in seconds, waste_time_like_a_verify burns per failed login to
    # keep the unknown-email path in the same timing class as a wrong-password
    # check. This is a fixed wall-clock cost paid on *every* failed attempt
    # regardless of Argon2 speed, so a brute-force test that fires off dozens
    # of bad logins pays dozens of these paddings back to back. Production
    # wants it comfortably above a real verify; tests want it short.
    login_timing_pad_seconds: float = Field(default=0.25, alias="LOGIN_TIMING_PAD_SECONDS")

    @model_validator(mode="after")
    def _normalise_database_urls(self) -> Settings:
        self.database_url = _rewrite_database_url(self.database_url, async_driver=True)
        self.test_database_url = _rewrite_database_url(self.test_database_url, async_driver=True)
        return self

    @model_validator(mode="after")
    def _refuse_an_unsafe_configuration(self) -> Settings:
        """Fail at import rather than at the first request.

        Every check here describes a deployment that looks like it works. The
        app boots, serves traffic, and is wrong in a way nobody sees until it is
        attacked, so the only useful place to catch it is before it can accept a
        single connection.
        """
        secret = self.jwt_secret.get_secret_value()
        if not secret or secret.strip() != secret or len(secret) < 32:
            raise ValueError(
                "JWT_SECRET must be at least 32 characters with no surrounding "
                "whitespace. Generate one with: openssl rand -hex 32"
            )
        # The placeholder ships in .env.example, so copying the file and filling
        # in only the database URLs leaves every token in the system signed with
        # a value that is public knowledge.
        if "CHANGEME" in secret.upper():
            raise ValueError(
                "JWT_SECRET is still the placeholder from .env.example. Anyone "
                "holding that file can mint a token for any account. Generate "
                "one with: openssl rand -hex 32"
            )

        # HS256 is what create_access_token signs with. Accepting "none" or an
        # RS/ES name here would mean the verifier accepts it too, and `none` is
        # the classic way to turn signature checking off entirely.
        if self.jwt_algorithm not in {"HS256", "HS384", "HS512"}:
            raise ValueError(
                f"JWT_ALGORITHM must be one of HS256, HS384, HS512, got {self.jwt_algorithm!r}"
            )

        if self.ai_provider is AIProvider.groq and not (
            self.groq_api_key and self.groq_api_key.get_secret_value().strip()
        ):
            raise ValueError(
                "AI_PROVIDER=groq needs GROQ_API_KEY. Set it, or use "
                "AI_PROVIDER=fake for the deterministic local estimator."
            )

        if self.environment is Environment.production:
            if "trust_proxy_headers" not in self.model_fields_set:
                raise ValueError(
                    "TRUST_PROXY_HEADERS must be explicitly set in production. "
                    "Set it to true only when a trusted reverse proxy rewrites "
                    "X-Forwarded-For; leaving it unset makes the app misidentify "
                    "shared CGNAT or proxy peers as one client."
                )
            if "*" in self.cors_origin_list:
                raise ValueError(
                    "CORS_ORIGINS must name real origins in production, not '*'. "
                    "A wildcard lets any site on the internet call this API with "
                    "a token it has phished."
                )
            if self.database_url.startswith("postgresql+asyncpg://postgres:postgres@"):
                raise ValueError(
                    "DATABASE_URL still carries the default postgres:postgres "
                    "credentials. Change them before running in production."
                )

        return self

    @property
    def docs_enabled(self) -> bool:
        """The interactive docs enumerate every route and schema. Fine on a
        laptop, free reconnaissance on a public host."""
        return self.environment is not Environment.production

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def google_client_id_list(self) -> list[str]:
        return [c.strip() for c in self.google_client_ids.split(",") if c.strip()]

    @property
    def google_enabled(self) -> bool:
        """Whether this deployment can accept a Google ID token at all.

        With no client ids configured there is no audience to check a token
        against, and a token whose audience nobody checks is a token anyone can
        mint for their own client and present here as somebody else. So the
        route answers 503 rather than verifying a signature and waving the
        claims through, and the app hides the button rather than offering one
        that cannot work.
        """
        return bool(self.google_client_id_list)

    @property
    def sync_database_url(self) -> str:
        """Alembic's offline/sync path needs a non-async driver URL."""
        return _rewrite_database_url(self.database_url, async_driver=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
