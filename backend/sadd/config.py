"""Typed settings. Every value has a safe default so the app boots with an empty .env."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
# Seed inputs (geojson, storm csv, fleet, protocols). Overridable so a packaged install
# (Docker image) can point at /app/data regardless of where the package itself lives.
DATA_DIR = Path(os.environ.get("SADD_DATA_DIR", REPO_ROOT / "data"))
# Trained model artifacts (joblib). `make train` writes them; the Docker build trains them.
ARTIFACTS_DIR = Path(os.environ.get("SADD_ARTIFACTS_DIR", Path(__file__).resolve().parents[1] / "artifacts"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", Path(".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql://sadd:sadd@localhost:5432/sadd"
    cors_origins: str = "http://localhost:3000"

    # Replay window (Asia/Qatar local dates, inclusive) and tick resolution.
    replay_start_date: str = "2024-04-15"
    replay_end_date: str = "2024-04-17"
    replay_tick_minutes: int = 10
    seed_force_fallback: bool = False

    # Doha reference point for Open-Meteo (no key required).
    open_meteo_lat: float = 25.2854
    open_meteo_lng: float = 51.5310

    # Production/Railway: seed automatically when the database is empty, and serve the static
    # frontend export from this process (path to frontend/out; empty = API only).
    seed_on_startup: bool = True
    frontend_dist: str = ""

    # Keys — all optional; features degrade gracefully when missing.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    flood_mcp_backend: str = "simulated"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
