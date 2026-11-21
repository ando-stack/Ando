from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..analysis.schemas import CATEGORY_LABELS
from ..config import get_settings
from ..db import get_db
from ..models import Activity, Analysis, Finding, Job, Match, Player, PlayerGoal, User
from ..replay.registry import adapters_status
from ..security import current_user
from ..video import transcribe
from ..video.ffmpeg import ffmpeg_version
from ..vision.provider import get_provider
from .common import iso, job_out

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    uid = user.id
    analyses = db.scalars(select(Analysis).where(Analysis.owner_id == uid, Analysis.is_current.is_(True)).order_by(Analysis.created_at)).all()
    matches = {m.id: m for m in db.scalars(select(Match).where(Match.owner_id == uid))}
    players = {p.id: p for p in db.scalars(select(Player).where(Player.owner_id == uid))}
    current_ids = [a.id for a in analyses]
    freq = []
    if current_ids:
        rows = db.execute(
            select(Finding.category, Finding.error_type, func.count(Finding.id)).where(
                Finding.analysis_id.in_(current_ids), Finding.review_status != "dismissed"
            ).group_by(Finding.category, Finding.error_type)
        ).all()
        by_cat: dict[str, dict] = {}
        for cat, et, n in rows:
            d = by_cat.setdefault(cat, {"category": cat, "label": CATEGORY_LABELS.get(cat, cat), "count": 0, "by_type": {}})
            d["count"] += n
            d["by_type"][et or "?"] = n
        freq = sorted(by_cat.values(), key=lambda x: -x["count"])
    evolution = []
    for a in analyses:
        m = matches.get(a.match_id)
        if not m:
            continue
        evolution.append({"date": iso(m.played_at or a.created_at), "overall": (a.scores or {}).get("overall"),
                          "player_id": m.player_id, "player_name": players[m.player_id].name if m.player_id in players else "?",
                          "match_id": m.id, "title": m.title})
    recent = []
    for a in sorted(analyses, key=lambda x: x.created_at, reverse=True)[:8]:
        m = matches.get(a.match_id)
        if m:
            n_find = db.scalar(select(func.count(Finding.id)).where(Finding.analysis_id == a.id, Finding.review_status != "dismissed"))
            recent.append({"match_id": m.id, "title": m.title, "player_name": players.get(m.player_id).name if m.player_id in players else "?",
                           "overall": (a.scores or {}).get("overall"), "findings": n_find, "source_type": a.source_type, "created_at": iso(a.created_at)})
    activity = db.scalars(select(Activity).where(Activity.owner_id == uid).order_by(Activity.created_at.desc()).limit(15)).all()
    goals = db.scalars(select(PlayerGoal).where(PlayerGoal.owner_id == uid, PlayerGoal.status == "pending").order_by(PlayerGoal.created_at.desc()).limit(10)).all()
    running = db.scalars(select(Job).where(Job.owner_id == uid, Job.status.in_(("queued", "running"))).order_by(Job.created_at)).all()
    sev = dict(db.execute(select(Finding.severity, func.count(Finding.id)).where(Finding.analysis_id.in_(current_ids), Finding.review_status != "dismissed").group_by(Finding.severity)).all()) if current_ids else {}
    scored = [e["overall"] for e in evolution if e["overall"] is not None]
    return {
        "totals": {
            "players": len(players), "matches": len(matches), "analyses": len(analyses),
            "pending_goals": db.scalar(select(func.count(PlayerGoal.id)).where(PlayerGoal.owner_id == uid, PlayerGoal.status == "pending")),
            "avg_score": round(sum(scored) / len(scored)) if scored else None,
            "findings_by_severity": sev,
        },
        "frequent_errors": freq,
        "evolution": evolution,
        "recent_analyses": recent,
        "activity": [{"id": x.id, "kind": x.kind, "message": x.message, "match_id": x.match_id, "player_id": x.player_id, "created_at": iso(x.created_at)} for x in activity],
        "pending_goals": [{"id": g.id, "title": g.title, "player_id": g.player_id, "player_name": players[g.player_id].name if g.player_id in players else "?", "category": g.category, "created_at": iso(g.created_at)} for g in goals],
        "running_jobs": [{**job_out(j), "match_id": j.match_id, "title": matches[j.match_id].title if j.match_id in matches else ""} for j in running],
    }


@router.get("/system/status")
def system_status(user: User = Depends(current_user)):
    s = get_settings()
    ok, why = get_provider().configured()
    stt_ok, stt_why = transcribe.available()
    return {
        "ffmpeg": ffmpeg_version(),
        "ai": {"configured": ok, "detail": why, "provider": s.vision_provider, "model": s.vision_model, "effort": s.vision_effort},
        "speech_to_text": {"available": stt_ok, "detail": stt_why},
        "replay_adapters": adapters_status(),
        "storage": s.storage_backend,
        "auth_mode": s.auth_mode,
        "database": "postgresql" if s.is_postgres else "sqlite",
        "limits": {"max_video_mb": s.max_video_bytes // (1024 * 1024), "max_replay_mb": s.max_replay_bytes // (1024 * 1024),
                   "max_video_minutes": s.max_video_seconds // 60, "chunk_mb": s.upload_chunk_bytes // (1024 * 1024)},
        "sampling": {"segment_seconds": s.segment_seconds, "max_frames_total": s.max_frames_total, "max_frames_per_segment": s.max_frames_per_segment},
        "worker": {"embedded": s.embedded_worker, "pid": os.getpid()},
    }
