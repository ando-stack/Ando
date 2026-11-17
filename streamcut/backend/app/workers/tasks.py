"""Actores Dramatiq. Colas separadas para poder escalar cada tipo de trabajo por separado:

- ingest:   validación, miniaturas, audio, proxies
- analysis: transcripción y detección (CPU/GPU intensivo)
- render:   renderizado de clips
- live:     creación de clips desde el buffer del directo (prioridad alta, baja latencia)
- publish: publicación en YouTube, TikTok e Instagram
- maintenance: retención y limpieza
"""

from __future__ import annotations

import uuid

import dramatiq

from app.core.logging import setup_logging

from . import broker  # noqa: F401  (configura el broker)

setup_logging()

# El estado de reintentos vive en la base de datos (attempts/max_attempts), no en Dramatiq.
_OPTS = {"max_retries": 0, "time_limit": 6 * 3600 * 1000}


@dramatiq.actor(queue_name="ingest", **_OPTS)
def ingest_asset(job_id: str) -> None:
    from app.services.pipeline import run_ingestion
    run_ingestion(uuid.UUID(job_id))


@dramatiq.actor(queue_name="analysis", **_OPTS)
def analyze_asset(job_id: str) -> None:
    from app.services.pipeline import run_analysis
    run_analysis(uuid.UUID(job_id))


@dramatiq.actor(queue_name="render", **_OPTS)
def render_export(export_id: str) -> None:
    from app.services.pipeline import run_export
    run_export(uuid.UUID(export_id))


@dramatiq.actor(queue_name="live", max_retries=0, time_limit=30 * 60 * 1000)
def live_make_clip(session_id: str, payload: dict) -> None:
    from app.live.clipper import make_live_clip
    make_live_clip(uuid.UUID(session_id), payload)


@dramatiq.actor(queue_name="publish", max_retries=0, time_limit=2 * 3600 * 1000)
def publish_clip(publication_id: str) -> None:
    from app.services.publishing import run_publication
    run_publication(uuid.UUID(publication_id))


@dramatiq.actor(queue_name="maintenance", max_retries=0, time_limit=60 * 60 * 1000)
def maintenance() -> None:
    from app.services.retention import run_retention
    run_retention()
