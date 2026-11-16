"""Dashboard y estadísticas: siempre calculadas a partir de la base de datos real."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.db.models import (
    AnalysisJob,
    Channel,
    Clip,
    DetectedEvent,
    Export,
    HighlightCandidate,
    IngestionJob,
    ProcessingLog,
    SourceAsset,
    StreamSession,
    WorkerHeartbeat,
    utcnow,
)
from app.db.session import get_db
from app.services.retention import storage_used

router = APIRouter(prefix="/stats", tags=["stats"])


def _count(db: Session, q) -> int:
    return int(db.scalar(q) or 0)


@router.get("/dashboard")
def dashboard(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    ws = p.workspace_id
    clips = select(func.count(Clip.id)).where(Clip.workspace_id == ws, Clip.deleted_at.is_(None))
    analyzed_sources = db.scalar(select(func.coalesce(func.sum(SourceAsset.duration), 0)).where(
        SourceAsset.workspace_id == ws, SourceAsset.kind == "upload",
        SourceAsset.id.in_(select(AnalysisJob.source_asset_id).where(AnalysisJob.status == "succeeded"))))
    live_seconds = db.scalar(select(func.coalesce(func.sum(StreamSession.analyzed_seconds), 0))
                             .where(StreamSession.workspace_id == ws))
    avg_an = db.scalar(select(func.avg(AnalysisJob.result["processing_seconds"].as_float()))
                       .where(AnalysisJob.workspace_id == ws, AnalysisJob.status == "succeeded"))
    avg_render = db.scalar(select(func.avg(Export.duration_s)).where(Export.workspace_id == ws,
                                                                     Export.status == "succeeded"))
    avg_latency = db.scalar(select(func.avg(Clip.detection_latency_s)).where(Clip.workspace_id == ws))
    fresh = utcnow() - timedelta(seconds=45)
    workers = [{"id": h.id, "kind": h.kind, "hostname": h.hostname, "last_seen_at": h.last_seen_at,
                "alive": h.last_seen_at >= fresh if h.last_seen_at.tzinfo else True,
                "info": {k: v for k, v in (h.info or {}).items() if k != "sessions"}}
               for h in db.scalars(select(WorkerHeartbeat).order_by(WorkerHeartbeat.last_seen_at.desc()).limit(20))]
    errors = [{"id": str(l.id), "job_type": l.job_type, "message": l.message, "created_at": l.created_at}
              for l in db.scalars(select(ProcessingLog).where(ProcessingLog.workspace_id == ws,
                                                              ProcessingLog.level == "error")
                                  .order_by(ProcessingLog.created_at.desc()).limit(10))]
    return {
        "channels_monitored": _count(db, select(func.count(Channel.id)).where(Channel.workspace_id == ws,
                                                                             Channel.is_tracked.is_(True))),
        "channels_total": _count(db, select(func.count(Channel.id)).where(Channel.workspace_id == ws)),
        "channels_live": _count(db, select(func.count(Channel.id)).where(Channel.workspace_id == ws,
                                                                        Channel.status == "online")),
        "streams_analyzed": _count(db, select(func.count(StreamSession.id)).where(
            StreamSession.workspace_id == ws, StreamSession.analyzed_seconds > 0)),
        "streams_total": _count(db, select(func.count(StreamSession.id)).where(StreamSession.workspace_id == ws)),
        "hours_processed": round((float(analyzed_sources or 0) + float(live_seconds or 0)) / 3600, 2),
        "videos_imported": _count(db, select(func.count(SourceAsset.id)).where(SourceAsset.workspace_id == ws,
                                                                              SourceAsset.kind == "upload",
                                                                              SourceAsset.deleted_at.is_(None))),
        "candidates": _count(db, select(func.count(HighlightCandidate.id)).where(
            HighlightCandidate.workspace_id == ws, HighlightCandidate.status != "duplicate")),
        "clips_created": _count(db, clips),
        "clips_approved": _count(db, clips.where(Clip.status.in_(("approved", "exported", "published")))),
        "clips_exported": _count(db, clips.where(Clip.status.in_(("exported", "published")))),
        "avg_analysis_seconds": round(avg_an, 1) if avg_an else None,
        "avg_render_seconds": round(avg_render, 1) if avg_render else None,
        "avg_live_latency_seconds": round(avg_latency, 1) if avg_latency else None,
        "storage_used_bytes": storage_used(db, ws),
        "storage_quota_bytes": p.workspace.storage_quota_bytes,
        "jobs_active": sum(_count(db, select(func.count(m.id)).where(m.workspace_id == ws,
                                                                     m.status.in_(("queued", "running"))))
                           for m in (IngestionJob, AnalysisJob, Export)),
        "workers": workers,
        "recent_errors": errors,
    }


@router.get("/timeseries")
def timeseries(days: int = Query(30, ge=1, le=365), p: Principal = Depends(current_principal),
               db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=days)
    ws = p.workspace_id

    def series(model, extra=()):
        # Agrupación por día en Python: portable entre PostgreSQL y SQLite
        out: dict[str, int] = {}
        for ts in db.scalars(select(model.created_at).where(model.workspace_id == ws, model.created_at >= since, *extra)):
            d = str(ts.date())
            out[d] = out.get(d, 0) + 1
        return out

    clips = series(Clip, (Clip.deleted_at.is_(None),))
    cands = series(HighlightCandidate, (HighlightCandidate.status != "duplicate",))
    events = series(DetectedEvent)
    out = []
    for i in range(days, -1, -1):
        d = str((utcnow() - timedelta(days=i)).date())
        out.append({"date": d, "clips": clips.get(d, 0), "candidates": cands.get(d, 0), "events": events.get(d, 0)})
    by_cat = db.execute(select(Clip.category, func.count(Clip.id)).where(Clip.workspace_id == ws,
                                                                       Clip.deleted_at.is_(None))
                        .group_by(Clip.category))
    by_status = db.execute(select(Clip.status, func.count(Clip.id)).where(Clip.workspace_id == ws,
                                                                        Clip.deleted_at.is_(None))
                           .group_by(Clip.status))
    hist: dict[int, int] = {}
    for sc in db.scalars(select(Clip.score).where(Clip.workspace_id == ws, Clip.deleted_at.is_(None),
                                                  Clip.score.is_not(None))):
        b = min(90, int(sc // 10) * 10)
        hist[b] = hist.get(b, 0) + 1
    by_channel = db.execute(select(Channel.display_name, func.count(Clip.id)).join(Clip, Clip.channel_id == Channel.id)
                            .where(Clip.workspace_id == ws, Clip.deleted_at.is_(None))
                            .group_by(Channel.display_name).order_by(func.count(Clip.id).desc()).limit(10))
    return {"daily": out, "by_category": [{"category": c or "—", "count": n} for c, n in by_cat],
            "by_status": [{"status": s, "count": n} for s, n in by_status],
            "score_histogram": [{"bucket": b, "count": hist.get(b, 0)} for b in range(0, 100, 10)],
            "by_channel": [{"channel": c, "count": n} for c, n in by_channel]}
