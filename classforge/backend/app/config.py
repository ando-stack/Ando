"""Configuración central de ClassForge AI (variables de entorno con valores por defecto)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "si", "sí", "on"}


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("CLASSFORGE_DATA_DIR", Path(__file__).resolve().parent.parent / "data")))
    # La clave SOLO se lee en el servidor. Nunca se envía al navegador.
    anthropic_api_key: str | None = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY") or None)
    model: str = field(default_factory=lambda: os.environ.get("CLASSFORGE_MODEL", "claude-opus-5-5"))
    effort: str = field(default_factory=lambda: os.environ.get("CLASSFORGE_EFFORT", "high"))
    # Reintento automático en otro modelo si el principal rechaza la petición.
    use_fallbacks: bool = field(default_factory=lambda: _bool("CLASSFORGE_FALLBACKS", True))
    ai_review: bool = field(default_factory=lambda: _bool("CLASSFORGE_AI_REVIEW", True))

    max_file_mb: int = field(default_factory=lambda: _int("CLASSFORGE_MAX_FILE_MB", 20))
    max_total_mb: int = field(default_factory=lambda: _int("CLASSFORGE_MAX_TOTAL_MB", 60))
    max_files: int = field(default_factory=lambda: _int("CLASSFORGE_MAX_FILES", 10))
    retention_hours: int = field(default_factory=lambda: _int("CLASSFORGE_RETENTION_HOURS", 24))
    cleanup_interval_s: int = field(default_factory=lambda: _int("CLASSFORGE_CLEANUP_INTERVAL_S", 600))

    # Límites de uso por cliente
    jobs_per_day: int = field(default_factory=lambda: _int("CLASSFORGE_JOBS_PER_DAY", 30))
    ai_calls_per_hour: int = field(default_factory=lambda: _int("CLASSFORGE_AI_CALLS_PER_HOUR", 40))

    max_ops_per_plan: int = field(default_factory=lambda: _int("CLASSFORGE_MAX_OPS", 400))
    max_chars_per_doc: int = field(default_factory=lambda: _int("CLASSFORGE_MAX_CHARS_PER_DOC", 120_000))
    max_image_pages: int = field(default_factory=lambda: _int("CLASSFORGE_MAX_IMAGE_PAGES", 8))

    cors_origins: list[str] = field(default_factory=lambda: [o.strip() for o in os.environ.get("CLASSFORGE_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()])
    soffice_path: str | None = field(default_factory=lambda: os.environ.get("CLASSFORGE_SOFFICE") or None)

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def ai_configured(self) -> bool:
        return bool(self.anthropic_api_key)


settings = Settings()
