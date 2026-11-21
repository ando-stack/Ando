"""Background job helpers shared by the API and the worker."""
from __future__ import annotations

import datetime as dt
import time

from sqlalchemy import select

from .db import session_scope
from .models import Job, Match, utcnow


class JobCancelled(Exception):
    pass


class PipelineError(Exception):
    """Error that should be shown to the coach as-is."""

    def __init__(self, message: str, code: str = "pipeline_error", match_status: str = "failed"):
        super().__init__(message)
        self.message = message
        self.code = code
        self.match_status = match_status


ACTIVE = ("queued", "running")


class JobCtx:
    def __init__(self, job_id: str, worker_id: str):
        self.job_id = job_id
        self.worker_id = worker_id
        self._last_write = 0.0
        self._stage = None

    def progress(self, stage: str, pct: float, message: str | None = None, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and stage == self._stage and now - self._last_write < 1.5:
            return
        self._stage = stage
        self._last_write = now
        with session_scope() as db:
            job = db.get(Job, self.job_id)
            if job is None:
                raise JobCancelled()
            if job.status == "cancelled":
                raise JobCancelled()
            job.stage = stage
            job.progress = round(max(0.0, min(100.0, pct)), 1)
            if message is not None:
                job.message = message
            job.heartbeat_at = utcnow()

    def log(self, text: str) -> None:
        with session_scope() as db:
            job = db.get(Job, self.job_id)
            if job:
                job.log = (job.log or []) + [{"t": utcnow().isoformat(), "msg": text[:500]}]

    def check_cancel(self) -> None:
        with session_scope() as db:
            job = db.get(Job, self.job_id)
            if job is None or job.status == "cancelled":
                raise JobCancelled()
            job.heartbeat_at = utcnow()


def enqueue(db, *, owner_id: str, match: Match, job_type: str, params: dict | None = None) -> Job:
    existing = db.scalar(select(Job).where(Job.match_id == match.id, Job.status.in_(ACTIVE)))
    if existing:
        return existing
    job = Job(owner_id=owner_id, match_id=match.id, type=job_type, params=params or {}, message="En cola")
    db.add(job)
    match.status = "queued"
    return job


def is_stale(job: Job, seconds: int) -> bool:
    hb = job.heartbeat_at or job.started_at
    if hb is None:
        return False
    if hb.tzinfo is None:
        hb = hb.replace(tzinfo=dt.timezone.utc)
    return (utcnow() - hb).total_seconds() > seconds
