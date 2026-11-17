"""Configuración central. Todo se lee de variables de entorno / .env (nunca del código)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="STREAMCUT_",
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["development", "production", "test"] = "development"
    # Modo de ejecución:
    #  - "api": solo HTTP (los workers y el monitor van en procesos aparte; Docker Compose).
    #  - "all-in-one": la API arranca dentro workers de cola + monitor (desarrollo en Windows sin Docker).
    run_mode: Literal["api", "all-in-one"] = "api"

    database_url: str = "postgresql+psycopg://streamcut:streamcut@localhost:5432/streamcut"
    redis_url: str = "redis://localhost:6379/0"
    # "redis" (producción) o "memory" (un único proceso, sin Redis).
    broker: Literal["redis", "memory"] = "redis"

    # Seguridad
    secret_key: str = Field(default="", description="Clave para firmar sesiones (obligatoria en producción)")
    encryption_key: str = Field(default="", description="Clave Fernet para cifrar tokens OAuth en reposo")
    session_max_age: int = 60 * 60 * 24 * 14
    cookie_secure: bool = False
    allowed_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    public_base_url: str = "http://localhost:3000"  # para callbacks OAuth
    rate_limit_per_minute: int = 600
    login_rate_limit_per_minute: int = 10

    # Almacenamiento
    storage_backend: Literal["local", "s3"] = "local"
    data_dir: Path = BACKEND_DIR.parent / "data"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    max_upload_bytes: int = 20 * 1024**3
    upload_chunk_max_bytes: int = 64 * 1024**2
    default_quota_bytes: int = 200 * 1024**3
    temp_max_age_hours: int = 24

    # Procesamiento
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    whisper_model: str = "base"
    whisper_live_model: str = "tiny"
    whisper_device: Literal["auto", "cpu", "cuda"] = "auto"
    transcription_enabled: bool = True
    proxy_height: int = 480
    worker_concurrency: int = 2
    max_live_ingests: int = 2
    hwaccel_encoder: str = ""  # p. ej. "h264_nvenc" si hay GPU NVIDIA

    # Directo
    live_segment_seconds: int = 4
    live_buffer_minutes: int = 20
    rtmp_listen_host: str = "0.0.0.0"
    rtmp_base_port: int = 1935
    allow_private_sources: bool = False  # permitir fuentes en redes privadas (p. ej. tu OBS en LAN)
    monitor_poll_seconds: int = 60

    # Integraciones (nunca hay valores por defecto: se obtienen en las consolas de desarrollador)
    twitch_client_id: str = ""
    twitch_client_secret: str = ""
    youtube_api_key: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    # Publicación en redes sociales
    tiktok_client_key: str = ""
    tiktok_client_secret: str = ""
    instagram_app_id: str = ""
    instagram_app_secret: str = ""

    demo_mode: bool = False

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
