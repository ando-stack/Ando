"""Runtime configuration (environment variables only; nothing secret reaches the browser)."""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return "ffmpeg"


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def _int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


def _bool(name: str, default: bool) -> bool:
    return (_env(name, "1" if default else "0") or "").lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    # --- core
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "./data")).resolve())
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL") or "")
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple((_env("CORS_ORIGINS", "http://localhost:3000") or "").split(","))
    )
    public_api_url: str = field(default_factory=lambda: _env("PUBLIC_API_URL", "http://localhost:8000"))

    # --- auth: "local" (built-in accounts) or "supabase" (Supabase Auth JWTs)
    auth_mode: str = field(default_factory=lambda: _env("AUTH_MODE", "local"))
    app_secret: str = field(default_factory=lambda: _env("APP_SECRET", "dev-insecure-change-me"))
    supabase_url: str | None = field(default_factory=lambda: _env("SUPABASE_URL"))
    supabase_jwt_secret: str | None = field(default_factory=lambda: _env("SUPABASE_JWT_SECRET"))
    allow_registration: bool = field(default_factory=lambda: _bool("ALLOW_REGISTRATION", True))

    # --- storage: "local" or "s3" (Supabase Storage S3 endpoint, MinIO, AWS...)
    storage_backend: str = field(default_factory=lambda: _env("STORAGE_BACKEND", "local"))
    s3_endpoint: str | None = field(default_factory=lambda: _env("S3_ENDPOINT"))
    s3_region: str = field(default_factory=lambda: _env("S3_REGION", "us-east-1"))
    s3_bucket: str = field(default_factory=lambda: _env("S3_BUCKET", "fortnite-vods"))
    s3_access_key: str | None = field(default_factory=lambda: _env("S3_ACCESS_KEY"))
    s3_secret_key: str | None = field(default_factory=lambda: _env("S3_SECRET_KEY"))

    # --- upload limits
    max_video_bytes: int = field(default_factory=lambda: _int("MAX_VIDEO_MB", 8192) * 1024 * 1024)
    max_replay_bytes: int = field(default_factory=lambda: _int("MAX_REPLAY_MB", 200) * 1024 * 1024)
    max_video_seconds: int = field(default_factory=lambda: _int("MAX_VIDEO_MINUTES", 240) * 60)
    upload_chunk_bytes: int = field(default_factory=lambda: _int("UPLOAD_CHUNK_MB", 8) * 1024 * 1024)

    # --- video processing
    # Sin FFmpeg instalado se usa el binario que trae el paquete pip imageio-ffmpeg.
    ffmpeg: str = field(default_factory=lambda: _env("FFMPEG_BIN") or _find_ffmpeg())
    ffprobe: str | None = field(default_factory=lambda: _env("FFPROBE_BIN") or shutil.which("ffprobe"))
    segment_seconds: int = field(default_factory=lambda: _int("SEGMENT_SECONDS", 60))
    max_frames_total: int = field(default_factory=lambda: _int("MAX_FRAMES_TOTAL", 480))
    max_frames_per_segment: int = field(default_factory=lambda: _int("MAX_FRAMES_PER_SEGMENT", 14))
    frame_width: int = field(default_factory=lambda: _int("FRAME_WIDTH", 1280))

    # --- AI (server side only)
    # "none" = solo lectura de HUD + reglas (por defecto, sin IA generativa)
    # "builtin" = modelo de visión integrado (se descarga solo, pip install -r requirements-ai.txt)
    # "ollama" = Ollama local · "anthropic" = API de Claude
    vision_provider: str = field(default_factory=lambda: _env("VISION_PROVIDER", "none"))
    builtin_max_images: int = field(default_factory=lambda: _int("BUILTIN_MAX_IMAGES", 4))
    hud_every: float = field(default_factory=lambda: _float("HUD_SAMPLE_SECONDS", 2.0))
    vision_model: str = field(default_factory=lambda: _env("VISION_MODEL") or "")
    ollama_url: str = field(default_factory=lambda: _env("OLLAMA_URL", "http://127.0.0.1:11434"))
    ollama_max_images: int = field(default_factory=lambda: _int("OLLAMA_MAX_IMAGES", 6))
    ollama_image_side: int = field(default_factory=lambda: _int("OLLAMA_IMAGE_SIDE", 896))
    ollama_num_ctx: int = field(default_factory=lambda: _int("OLLAMA_NUM_CTX", 16384))
    ollama_timeout: float = field(default_factory=lambda: _float("OLLAMA_TIMEOUT", 900))
    vision_effort: str = field(default_factory=lambda: _env("VISION_EFFORT", "high"))
    vision_fallbacks: bool = field(default_factory=lambda: _bool("VISION_FALLBACKS", True))
    vision_concurrency: int = field(default_factory=lambda: _int("VISION_CONCURRENCY", 3))
    whisper_model: str | None = field(default_factory=lambda: _env("WHISPER_MODEL"))  # e.g. "small"

    # --- replays
    frd_cli: str | None = field(default_factory=lambda: _env("FRD_CLI"))  # path to FrdExport binary
    frd_timeout: int = field(default_factory=lambda: _int("FRD_TIMEOUT", 300))

    # --- worker
    embedded_worker: bool = field(default_factory=lambda: _bool("EMBEDDED_WORKER", False))
    job_stale_seconds: int = field(default_factory=lambda: _int("JOB_STALE_SECONDS", 600))
    job_max_attempts: int = field(default_factory=lambda: _int("JOB_MAX_ATTEMPTS", 2))

    def __post_init__(self):
        if not self.vision_model:
            default_models = {"ollama": "qwen2.5vl:7b", "builtin": "Qwen/Qwen2.5-VL-3B-Instruct", "anthropic": "claude-opus-5-5", "none": "reglas"}
            object.__setattr__(self, "vision_model", default_models.get(self.vision_provider, "reglas"))
        if not self.database_url:
            object.__setattr__(self, "database_url", f"sqlite:///{self.data_dir / 'fva.db'}")

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgres")

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.auth_mode == "local" and s.app_secret == "dev-insecure-change-me":
        import logging

        logging.getLogger("fva").warning("APP_SECRET no configurado: usando un secreto de desarrollo inseguro.")
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.tmp_dir.mkdir(parents=True, exist_ok=True)
    return s
