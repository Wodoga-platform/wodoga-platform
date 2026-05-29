"""
Wodoga Platform — Application Configuration
All settings loaded from environment variables with type validation.
"""

from functools import lru_cache
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Application ─────────────────────────────────────────
    app_name: str = "Wodoga Platform"
    app_version: str = "2.0.0"
    app_env: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    secret_key: str
    allowed_origins: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    # ── Database ────────────────────────────────────────────
    database_url: str
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # ── Authentication ──────────────────────────────────────
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    mfa_issuer: str = "Wodoga Platform"

    # ── Encryption ──────────────────────────────────────────
    encryption_key: str

    # ── Azure Blob Storage ──────────────────────────────────
    azure_storage_account_name: str = ""
    azure_storage_account_key: str = ""
    azure_storage_connection_string: str = ""
    azure_storage_container_documents: str = "documents"
    azure_storage_container_signatures: str = "signatures"
    azure_storage_sas_token_expiry_hours: int = 2

    # ── Insurance Eligibility ────────────────────────────────
    eligibility_provider: Literal["waystar", "availity", "simulated"] = "simulated"
    waystar_api_url: str = ""
    waystar_api_key: str = ""
    waystar_submitter_id: str = ""
    availity_api_url: str = ""
    availity_client_id: str = ""
    availity_client_secret: str = ""

    # ── Email ───────────────────────────────────────────────
    sendgrid_api_key: str = ""
    email_from: str = "noreply@wodoga.com"
    email_from_name: str = "Wodoga Platform"

    # ── SMS / MFA ────────────────────────────────────────────
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    # ── Redis ───────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── Rate Limiting ────────────────────────────────────────
    rate_limit_default: str = "100/minute"
    rate_limit_auth: str = "10/minute"
    rate_limit_eligibility: str = "30/minute"

    # ── Security ────────────────────────────────────────────
    max_login_attempts: int = 5
    account_lockout_minutes: int = 30
    password_min_length: int = 10
    session_timeout_minutes: int = 30

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache()
def get_settings() -> Settings:
    """
    Returns a cached singleton Settings instance.
    Use as a FastAPI dependency: settings = Depends(get_settings)
    """
    return Settings()
