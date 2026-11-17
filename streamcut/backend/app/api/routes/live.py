from __future__ import annotations

import re
import time
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.api.routes.channels import _get, channel_out
from app.db.models import (
    AnalysisJob,
    Clip,
    DetectedEvent,
    Export,
    IngestionJob,
    StreamSession,
    WorkerHeartbeat,
    utcnow,
)
from app.db.session import get_db
from app.services.bus import publish
from app.services.jobs import event_dict, record_event

router = APIRouter(prefix="/live", tags=["live"])
HOST_RE = re.compile(r"^[a-zA-Z0-9.\-]{1,253}$")


@router.get("/{channel_id}/embed")
def embed(channel_id: uuid.UUID, parent: str = Query(..., max_length=253), p: Principal = Depends(current_principal),
          db: Session = Depends(get_db)):
    """URLs del reproductor oficial (Twitch exige el parámetro parent = dominio de la página)."""
    if not HOST_RE.match(parent):
        raise HTTPException(422, "parent no válido")
    c = _get(db, p, channel_id)
    if c.platform == "twitch":
        return {"player": f"https://player.twitch.tv/?channel={c.external_id}&parent={parent}&muted=true&autoplay=true",
                "chat": f"https://www.twitch.tv/embed/{c.external_id}/chat?parent={parent}&darkpopout",
                "original": c.url}
    if c.live_video_id:
        player = f"https://www.youtube-nocookie.com/embed/{c.live_video_id}?autoplay=1&mute=1"
        chat = f"https://www.youtube.com/live_chat?v={c.live_video_id}&embed_domain={parent}"
    elif c.external_id.startswith("UC"):
        player = f"https://www.youtube-nocookie.com/embed/live_stream?channel={c.external_id}&autoplay=1&mute=1"
        chat = None
    else:
        player, chat = None, None
    return {"player": player, "chat": chat, "original": c.url}


def _refresh(db: Session, c) -> None:
    """Consulta a la plataforma el estado real del canal (si hay credenciales)."""
    from app.services.channels import refresh_capabilities, refresh_status
    refresh_status(db, [c])
    refresh_capabilities(db, c)


def _live_session(db: Session, channel_id: uuid.UUID) -> StreamSession | None:
    return db.scalar(select(StreamSession).where(StreamSession.channel_id == channel_id,
                                                 StreamSession.status == "live").order_by(StreamSession.started_at.desc()))


@router.post("/{channel_id}/start")
def start_monitoring(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    _refresh(db, c)
    c.is_tracked = True  # al monitorizar, el estado se consulta automáticamente cada minuto
    if c.status == "offline":
        raise HTTPException(409, "El canal no está en directo ahora mismo")
    sess = _live_session(db, c.id)
    if sess is None:
        # Estado desconocido (sin credenciales de API): se abre una sesión manual.
        sess = StreamSession(workspace_id=c.workspace_id, channel_id=c.id, title=c.title, category=c.category,
                             capability_mode=(c.capabilities or {}).get("mode", "VIEW_ONLY"),
                             stats={"manual": True})
        db.add(sess)
        db.flush()
    sess.monitoring = True
    sess.capability_mode = (c.capabilities or {}).get("mode", "VIEW_ONLY")
    sess.stats = {**(sess.stats or {}), "manually_stopped": False}
    record_event(db, workspace_id=c.workspace_id, type="monitoring_start",
                 label=f"Monitorización iniciada ({sess.capability_mode})", channel_id=c.id,
                 stream_session_id=sess.id)
    db.commit()
    return channel_out(db, c)


@router.post("/{channel_id}/stop")
def stop_monitoring(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    sess = _live_session(db, c.id)
    if sess is not None:
        sess.monitoring = False
        sess.stats = {**(sess.stats or {}), "manually_stopped": True}
        if (sess.stats or {}).get("manual") and c.status != "online":
            sess.status, sess.ended_at = "ended", utcnow()
        record_event(db, workspace_id=c.workspace_id, type="monitoring_stop", label="Monitorización detenida",
                     channel_id=c.id, stream_session_id=sess.id)
        db.commit()
    return channel_out(db, c)


@router.post("/{channel_id}/platform-clip")
def platform_clip(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    if c.platform != "twitch":
        raise HTTPException(422, "Solo Twitch permite crear clips oficiales por API")
    _refresh(db, c)
    sess = _live_session(db, c.id)
    if c.status == "error":
        raise HTTPException(409, f"No se pudo consultar Twitch: {c.last_error or 'error de API'}. "
                                 "Revisa STREAMCUT_TWITCH_CLIENT_ID y _SECRET en el archivo .env")
    if c.status == "unknown":
        raise HTTPException(409, "No se puede comprobar si el canal está en directo: faltan las "
                                 "credenciales de Twitch o no son válidas")
    if sess is None or c.status != "online":
        raise HTTPException(409, "Twitch indica que el canal no está en directo ahora mismo. "
                                 "Pulsa el botón de actualizar estado y vuelve a intentarlo")
    feats = {f["key"]: f for f in (c.capabilities or {}).get("features", [])}
    if feats.get("platform_clips", {}).get("status") != "available":
        raise HTTPException(403, feats.get("platform_clips", {}).get("detail", "Falta autorización"))
    from app.live.clipper import create_platform_clip
    clip = create_platform_clip(sess.id, "manual", time.time())
    if clip is None:
        raise HTTPException(502, "Twitch no permitió crear el clip (revisa el registro de eventos)")
    return {"id": str(clip.id), "url": clip.platform_clip_url}


@router.get("/events")
def events(channel_id: uuid.UUID | None = None, session_id: uuid.UUID | None = None, limit: int = Query(50, le=500),
           p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(DetectedEvent).where(DetectedEvent.workspace_id == p.workspace_id)
    if channel_id:
        q = q.where(DetectedEvent.channel_id == channel_id)
    if session_id:
        q = q.where(DetectedEvent.stream_session_id == session_id)
    if not channel_id and not session_id:
        q = q.where(DetectedEvent.channel_id.is_not(None))
    return [event_dict(e) for e in db.scalars(q.order_by(DetectedEvent.created_at.desc()).limit(limit))]


@router.get("/status")
def status(channel_id: uuid.UUID | None = None, p: Principal = Depends(current_principal),
           db: Session = Depends(get_db)):
    """Estado real del panel AI LIVE DETECTION: latido del monitor, sesión, trabajos y recursos."""
    fresh = utcnow() - timedelta(seconds=30)
    beats = list(db.scalars(select(WorkerHeartbeat).where(WorkerHeartbeat.last_seen_at >= fresh)))
    monitor_alive = any(b.kind == "monitor" for b in beats)
    sessions = [s for b in beats for s in (b.info or {}).get("sessions", [])]
    resources = next((b.info.get("resources") for b in beats if b.info.get("resources")), {})
    out = {"monitor_alive": monitor_alive, "resources": resources}
    pending = {
        "ingestion": db.scalar(select(func.count(IngestionJob.id)).where(IngestionJob.workspace_id == p.workspace_id,
                                                                        IngestionJob.status.in_(("queued", "running")))),
        "analysis": db.scalar(select(func.count(AnalysisJob.id)).where(AnalysisJob.workspace_id == p.workspace_id,
                                                                      AnalysisJob.status.in_(("queued", "running")))),
        "render": db.scalar(select(func.count(Export.id)).where(Export.workspace_id == p.workspace_id,
                                                               Export.status.in_(("queued", "running")))),
    }
    out["pending_jobs"] = pending
    if channel_id:
        c = _get(db, p, channel_id)
        sess = _live_session(db, c.id)
        runner = next((s for s in sessions if sess and s["session_id"] == str(sess.id)), None)
        out["session"] = None
        if sess:
            clips = db.scalar(select(func.count(Clip.id)).where(Clip.stream_session_id == sess.id))
            rendered = db.scalar(select(func.count(Clip.id)).where(Clip.stream_session_id == sess.id,
                                                                    Clip.status.in_(("pending", "approved", "exported",
                                                                                     "published"))))
            cands = db.scalar(select(func.count(DetectedEvent.id)).where(DetectedEvent.stream_session_id == sess.id,
                                                                         DetectedEvent.type == "candidate"))
            lat = db.scalar(select(func.avg(Clip.detection_latency_s)).where(Clip.stream_session_id == sess.id))
            out["session"] = {"id": str(sess.id), "monitoring": sess.monitoring, "mode": sess.capability_mode,
                              "started_at": sess.started_at, "analyzed_seconds": sess.analyzed_seconds,
                              "clips": clips, "rendered": rendered, "candidates": cands,
                              "avg_latency_s": round(lat, 1) if lat else None, "runner": runner}
    return out


@router.post("/ping")
def ping(p: Principal = Depends(current_principal)):
    publish(p.workspace_id, "ping", {"t": time.time()})
    return {"ok": True}
