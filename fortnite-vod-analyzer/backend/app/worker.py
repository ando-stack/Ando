"""Background worker: `python -m app.worker`.

Claims queued jobs atomically (PostgreSQL: FOR UPDATE SKIP LOCKED, so several
workers can run in parallel; SQLite: conditional UPDATE), heartbeats while
running, re-queues jobs whose worker died, and records failures with a
human-readable message.
"""
from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
import traceback

from sqlalchemy import delete, select, update

from .config import get_settings
from .db import init_db, session_scope
from .jobs import JobCancelled, JobCtx, PipelineError, is_stale
from .models import Analysis, Job, Match, log_activity, utcnow
from .video.ffmpeg import VideoError
from .vision.provider import ProviderError

log = logging.getLogger("fva.worker")
_stop = threading.Event()


def claim_job(worker_id: str) -> str | None:
    s = get_settings()
    with session_scope() as db:
        q = select(Job).where(Job.status == "queued").order_by(Job.created_at).limit(1)
        if s.is_postgres:
            q = q.with_for_update(skip_locked=True)
        job = db.scalar(q)
        if not job:
            return None
        res = db.execute(
            update(Job).where(Job.id == job.id, Job.status == "queued").values(
                status="running", locked_by=worker_id, started_at=utcnow(), heartbeat_at=utcnow(), attempts=Job.attempts + 1
            )
        )
        if res.rowcount != 1:
            return None
        m = db.get(Match, job.match_id)
        if m:
            m.status = "processing"
        return job.id


def requeue_stale() -> None:
    s = get_settings()
    with session_scope() as db:
        for job in db.scalars(select(Job).where(Job.status == "running")):
            if is_stale(job, s.job_stale_seconds):
                if job.attempts < s.job_max_attempts:
                    job.status, job.locked_by, job.message = "queued", None, "Reintentando (el proceso anterior se detuvo)"
                else:
                    job.status, job.error, job.finished_at = "failed", "El proceso de análisis se detuvo varias veces.", utcnow()
                    m = db.get(Match, job.match_id)
                    if m:
                        m.status = "failed"


def run_job(job_id: str, worker_id: str) -> None:
    from .analysis.replay_pipeline import run_replay_analysis
    from .analysis.video_pipeline import run_video_analysis

    with session_scope() as db:
        job = db.get(Job, job_id)
        jtype, match_id, owner_id = job.type, job.match_id, job.owner_id
    ctx = JobCtx(job_id, worker_id)
    try:
        if jtype == "analyze_video":
            run_video_analysis(ctx, match_id, owner_id)
        elif jtype == "analyze_replay":
            run_replay_analysis(ctx, match_id, owner_id)
        else:
            raise PipelineError(f"Tipo de trabajo desconocido: {jtype}")
        _finish(job_id, "completed", None, None)
    except JobCancelled:
        _cleanup_partial(job_id)
        with session_scope() as db:
            m = db.get(Match, match_id)
            if m and m.status in ("processing", "queued"):
                m.status = "uploaded"
    except PipelineError as e:
        _fail(job_id, e.message, e.code, e.match_status)
    except VideoError as e:
        _fail(job_id, e.message, e.code, "failed")
    except ProviderError as e:
        _fail(job_id, e.message, e.code, "failed")
    except Exception as e:  # noqa: BLE001
        log.exception("job %s crashed", job_id)
        _fail(job_id, f"Error interno durante el análisis ({type(e).__name__}). Revisa los logs del worker.", "internal",
              "failed", detail=traceback.format_exc()[-2000:])


def _cleanup_partial(job_id: str) -> None:
    from .storage import get_storage

    with session_scope() as db:
        for a in db.scalars(select(Analysis).where(Analysis.job_id == job_id, Analysis.is_current.is_(False))):
            get_storage().delete_prefix(f"{a.owner_id}/{a.match_id}/analyses/{a.id}")
        db.execute(delete(Analysis).where(Analysis.job_id == job_id, Analysis.is_current.is_(False)))


def _finish(job_id: str, status: str, error: str | None, code: str | None) -> None:
    with session_scope() as db:
        job = db.get(Job, job_id)
        job.status, job.error, job.error_code, job.finished_at = status, error, code, utcnow()
        if status == "completed":
            job.progress = 100


def _fail(job_id: str, message: str, code: str, match_status: str, detail: str | None = None) -> None:
    _cleanup_partial(job_id)
    with session_scope() as db:
        job = db.get(Job, job_id)
        job.status, job.error, job.error_code, job.finished_at = "failed", message, code, utcnow()
        job.message = message
        if detail:
            job.log = (job.log or []) + [{"t": utcnow().isoformat(), "msg": detail}]
        m = db.get(Match, job.match_id)
        if m:
            m.status = match_status
            log_activity(db, job.owner_id, "analysis_failed", f"Análisis fallido: {m.title} — {message[:150]}", match_id=m.id, player_id=m.player_id)


def loop(worker_id: str | None = None, poll: float = 2.0) -> None:
    worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}:{threading.get_ident()}"
    last_stale = 0.0
    while not _stop.is_set():
        if time.monotonic() - last_stale > 60:
            requeue_stale()
            last_stale = time.monotonic()
        job_id = claim_job(worker_id)
        if job_id:
            log.info("running job %s", job_id)
            run_job(job_id, worker_id)
        else:
            _stop.wait(poll)


def start_embedded() -> threading.Thread:
    t = threading.Thread(target=loop, name="embedded-worker", daemon=True)
    t.start()
    return t


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    init_db()
    signal.signal(signal.SIGTERM, lambda *_: _stop.set())
    signal.signal(signal.SIGINT, lambda *_: _stop.set())
    log.info("worker started")
    loop()


if __name__ == "__main__":
    main()
