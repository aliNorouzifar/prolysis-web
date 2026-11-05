"""Backend configuration (environment-driven)."""
from __future__ import annotations

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # libpq-style URL; psycopg (and Procrastinate) accept it directly.
    database_url: str = "postgresql://prolysis:prolysis@localhost:5432/prolysis"

    # Allowed CORS origins for the BFF/frontend during local dev.
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]

    # Where transient discovery working files go (kept small; results live in Postgres).
    work_dir: str = "/tmp/prolysis-work"

    @cached_property
    def sqlalchemy_url(self) -> str:
        """SQLAlchemy needs the driver named in the scheme; psycopg3 here."""
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


settings = Settings()
