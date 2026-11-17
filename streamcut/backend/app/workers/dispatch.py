"""Encolado de trabajos. Importa los actores de forma diferida para evitar ciclos."""

from __future__ import annotations

import uuid


def enqueue_ingestion(job_id: uuid.UUID, delay_ms: int | None = None) -> None:
    from .tasks import ingest_asset
    ingest_asset.send_with_options(args=(str(job_id),), delay=delay_ms)


def enqueue_analysis(job_id: uuid.UUID, delay_ms: int | None = None) -> None:
    from .tasks import analyze_asset
    analyze_asset.send_with_options(args=(str(job_id),), delay=delay_ms)


def enqueue_export(export_id: uuid.UUID, delay_ms: int | None = None) -> None:
    from .tasks import render_export
    render_export.send_with_options(args=(str(export_id),), delay=delay_ms)


def enqueue_live_clip(session_id: uuid.UUID, payload: dict) -> None:
    from .tasks import live_make_clip
    live_make_clip.send(str(session_id), payload)


def enqueue_maintenance() -> None:
    from .tasks import maintenance
    maintenance.send()


def enqueue_publication(publication_id: uuid.UUID) -> None:
    from .tasks import publish_clip
    publish_clip.send(str(publication_id))
