"""Estado de trabajos (ingesta, análisis, exportación): progreso, cancelación, reintentos y logs."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AnalysisJob,
    DetectedEvent,
    Export,
    IngestionJob,
    ProcessingLog,
    utcnow,
)
from app.db.session import SessionLocal

from .bus import publish

log = logging.getLogger(__name__)

JOB_MODELS = {"ingestion": IngestionJob, "analysis": AnalysisJob, "export": Export}
Job = IngestionJob | AnalysisJob | Export


def job_dict(kind: str, job: Job) -> dict[str, Any]:
    d = {"id": str(job.id), "kind": kind, "status": job.status, "stage": job.stage,
         "progress": round(job.progress, 3), "error": job.error, "attempts": job.attempts,
         "created_at": job.created_at, "started_at": job.started_at, "finished_at": job.finished_at}
    if isinstance(job, (IngestionJob, AnalysisJob)) and job.source_asset_id:
        d["source_asset_id"] = str(job.source_asset_id)
    if isinstance(job, AnalysisJob):
        d["result"] = job.result
        d["analysis_kind"] = job.kind
    if isinstance(job, Export):
        d["clip_id"] = str(job.clip_id)
        d["clip_version_id"] = str(job.clip_version_id)
    return d


class JobContext:
    """Contexto de ejecución de un trabajo: actualiza progreso (con throttling) y comprueba cancelación."""

    def __init__(self, kind: str, job_id: uuid.UUID):
        self.kind = kind
        self.model = JOB_MODELS[kind]
        self.job_id = job_id
        self._last_push = 0.0
        self._last_cancel_check = 0.0
        self._cancelled = False
        with SessionLocal() as db:
            job = db.get(self.model, job_id)
            if job is None:
                raise LookupError(f"Trabajo {kind} {job_id} no existe")
            self.workspace_id = job.workspace_id

    def start(self) -> bool:
        with SessionLocal() as db:
            job = db.get(self.model, self.job_id)
            if job is None or job.status in ("succeeded", "cancelled"):
                return False
            if job.cancel_requested:
                job.status = "cancelled"
                job.finished_at = utcnow()
                db.commit()
                return False
            job.status = "running"
            job.attempts += 1
            job.started_at = utcnow()
            job.error = None
            db.commit()
            publish(self.workspace_id, "job", job_dict(self.kind, job))
        return True

    def progress(self, value: float, stage: str | None = None, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_push < 0.7:
            return
        self._last_push = now
        with SessionLocal() as db:
            job = db.get(self.model, self.job_id)
            if job is None:
                return
            job.progress = float(max(0.0, min(1.0, value)))
            if stage:
                job.stage = stage
            db.commit()
            publish(self.workspace_id, "job", job_dict(self.kind, job))

    def cancelled(self) -> bool:
        if self._cancelled:
            return True
        now = time.monotonic()
        if now - self._last_cancel_check < 1.0:
            return False
        self._last_cancel_check = now
        with SessionLocal() as db:
            job = db.get(self.model, self.job_id)
            self._cancelled = bool(job is None or job.cancel_requested)
        return self._cancelled

    def finish(self, status: str, error: str | None = None, result: dict | None = None) -> None:
        with SessionLocal() as db:
            job = db.get(self.model, self.job_id)
            if job is None:
                return
            job.status = status
            job.error = error[:4000] if error else None
            job.finished_at = utcnow()
            if status == "succeeded":
                job.progress = 1.0
                job.stage = "Completado"
            if result is not None and hasattr(job, "result"):
                job.result = result
            db.commit()
            publish(self.workspace_id, "job", job_dict(self.kind, job))

    def should_retry(self) -> bool:
        with SessionLocal() as db:
            job = db.get(self.model, self.job_id)
            return bool(job and not job.cancel_requested and job.attempts < job.max_attempts)

    def log(self, level: str, message: str, **data: Any) -> None:
        write_log(self.workspace_id, self.kind, self.job_id, level, message, **data)


def write_log(workspace_id: uuid.UUID | None, job_type: str, job_id: uuid.UUID | None, level: str,
              message: str, **data: Any) -> None:
    getattr(log, level if level in ("info", "warning", "error") else "info")("[%s %s] %s", job_type, job_id, message)
    with SessionLocal() as db:
        db.add(ProcessingLog(workspace_id=workspace_id, job_type=job_type, job_id=job_id, level=level,
                             message=message[:4000], data=data))
        db.commit()
    if level in ("warning", "error"):
        publish(workspace_id, "log", {"job_type": job_type, "job_id": job_id, "level": level, "message": message})


def record_event(db: Session, *, workspace_id: uuid.UUID, type: str, label: str, source_asset_id=None,
                 stream_session_id=None, channel_id=None, t_start=None, t_end=None, confidence=None,
                 value=None, data: dict | None = None, notify: bool = True) -> DetectedEvent:
    ev = DetectedEvent(workspace_id=workspace_id, type=type, label=label, source_asset_id=source_asset_id,
                       stream_session_id=stream_session_id, channel_id=channel_id, t_start=t_start, t_end=t_end,
                       confidence=confidence, value=value, data=data or {})
    db.add(ev)
    db.flush()
    if notify:
        publish(workspace_id, "detection", event_dict(ev))
    return ev


def event_dict(ev: DetectedEvent) -> dict[str, Any]:
    return {"id": str(ev.id), "type": ev.type, "label": ev.label, "t_start": ev.t_start, "t_end": ev.t_end,
            "confidence": ev.confidence, "value": ev.value, "data": ev.data,
            "channel_id": str(ev.channel_id) if ev.channel_id else None,
            "stream_session_id": str(ev.stream_session_id) if ev.stream_session_id else None,
            "source_asset_id": str(ev.source_asset_id) if ev.source_asset_id else None,
            "created_at": ev.created_at}


def request_cancel(db: Session, kind: str, job_id: uuid.UUID, workspace_id: uuid.UUID) -> Job | None:
    model = JOB_MODELS[kind]
    job = db.scalar(select(model).where(model.id == job_id, model.workspace_id == workspace_id))
    if job is None:
        return None
    job.cancel_requested = True
    if job.status == "queued":
        job.status = "cancelled"
        job.finished_at = utcnow()
    db.commit()
    publish(workspace_id, "job", job_dict(kind, job))
    return job
