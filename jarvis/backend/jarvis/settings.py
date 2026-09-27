"""Process configuration.

Everything that differs between deployments comes from environment variables
(`.env` in docker compose). Provider API keys may alternatively be entered in
the UI — those are stored encrypted in the database and resolved at runtime by
`jarvis.core.secrets.SecretStore`; an environment variable always wins.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _alias(*names: str) -> AliasChoices:
    return AliasChoices(*names)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="JARVIS_", env_file=None, extra="ignore")

    # ---- runtime -------------------------------------------------------------------------------
    env: Literal["production", "development", "test"] = "production"
    public_url: str = "http://localhost:8080"
    log_level: str = "INFO"
    log_json: bool = True
    # Run the task worker inside the API process (single-process dev / tests).
    embedded_worker: bool = False
    worker_concurrency: int = 4
    worker_id: str | None = None

    # ---- storage -------------------------------------------------------------------------------
    database_url: str = "postgresql+asyncpg://jarvis:jarvis@postgres:5432/jarvis"
    redis_url: str = "redis://redis:6379/0"
    data_dir: Path = Path("/data")
    config_dir: Path = Path("/app/config")
    skills_dir: Path = Path("/app/skills")

    # ---- security ------------------------------------------------------------------------------
    # Comma separated Fernet keys, newest first. Generated into data_dir/secrets on first boot when empty.
    master_keys: str = ""
    session_ttl_days: int = 30
    cookie_secure: bool | None = None  # default: derived from public_url scheme
    owner_email: str | None = None
    owner_password: str | None = None
    owner_name: str = "Owner"
    # Token protecting /metrics (Prometheus scrapes with Authorization: Bearer <token>).
    metrics_token: str | None = None
    approval_ttl_hours: int = 24

    # ---- user defaults -------------------------------------------------------------------------
    timezone: str = "UTC"
    locale: str = "ru"

    # ---- brain ---------------------------------------------------------------------------------
    anthropic_api_key: str | None = Field(default=None, validation_alias=_alias("ANTHROPIC_API_KEY"))
    # Optional OpenAI-compatible endpoint (Ollama / vLLM / LM Studio) for a private local model route.
    local_llm_base_url: str | None = None
    local_llm_api_key: str | None = None
    daily_cost_limit_usd: float = 20.0
    max_agent_steps: int = 25
    # Use the scripted offline model (tests / demo without an API key).
    fake_llm: bool = False

    # ---- memory --------------------------------------------------------------------------------
    embedding_provider: Literal["local", "voyage", "openai", "hash", "none"] = "local"
    embedding_model: str | None = None
    voyage_api_key: str | None = Field(default=None, validation_alias=_alias("VOYAGE_API_KEY"))
    openai_api_key: str | None = Field(default=None, validation_alias=_alias("OPENAI_API_KEY"))

    # ---- web -----------------------------------------------------------------------------------
    search_provider: Literal["anthropic", "tavily", "brave", "none"] = "anthropic"
    tavily_api_key: str | None = Field(default=None, validation_alias=_alias("TAVILY_API_KEY"))
    brave_api_key: str | None = Field(default=None, validation_alias=_alias("BRAVE_API_KEY"))

    # ---- voice ---------------------------------------------------------------------------------
    stt_provider: Literal["deepgram", "openai", "browser"] = "deepgram"
    tts_provider: Literal["elevenlabs", "openai", "browser"] = "elevenlabs"
    deepgram_api_key: str | None = Field(default=None, validation_alias=_alias("DEEPGRAM_API_KEY"))
    elevenlabs_api_key: str | None = Field(default=None, validation_alias=_alias("ELEVENLABS_API_KEY"))
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model: str = "eleven_flash_v2_5"

    # ---- channels ------------------------------------------------------------------------------
    telegram_bot_token: str | None = Field(default=None, validation_alias=_alias("TELEGRAM_BOT_TOKEN"))
    telegram_mode: Literal["webhook", "polling", "off"] = "polling"
    telegram_webhook_secret: str | None = None
    whatsapp_access_token: str | None = Field(default=None, validation_alias=_alias("WHATSAPP_ACCESS_TOKEN"))
    whatsapp_phone_number_id: str | None = Field(default=None, validation_alias=_alias("WHATSAPP_PHONE_NUMBER_ID"))
    whatsapp_app_secret: str | None = Field(default=None, validation_alias=_alias("WHATSAPP_APP_SECRET"))
    whatsapp_verify_token: str | None = Field(default=None, validation_alias=_alias("WHATSAPP_VERIFY_TOKEN"))
    whatsapp_graph_version: str = "v21.0"

    # ---- integrations --------------------------------------------------------------------------
    google_client_id: str | None = Field(default=None, validation_alias=_alias("GOOGLE_CLIENT_ID"))
    google_client_secret: str | None = Field(default=None, validation_alias=_alias("GOOGLE_CLIENT_SECRET"))

    # ---- isolated tool runtimes ----------------------------------------------------------------
    browser_ws_endpoint: str | None = None  # e.g. ws://browser:3000/
    sandbox_url: str | None = None  # e.g. http://sandbox:8090
    sandbox_token: str | None = None

    @field_validator("public_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def is_test(self) -> bool:
        return self.env == "test"

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.public_url.startswith("https://")

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def secrets_dir(self) -> Path:
        return self.data_dir / "secrets"


@lru_cache
def get_settings() -> Settings:
    return Settings()

