from __future__ import annotations

import datetime as dt

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Analysis, Finding, Job, Match, MediaFile, Player


def iso(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime) and v.tzinfo is None:
        v = v.replace(tzinfo=dt.timezone.utc)
    return v.isoformat()


def get_player(db: Session, owner_id: str, player_id: str) -> Player:
    p = db.get(Player, player_id)
    if not p or p.owner_id != owner_id:
        raise HTTPException(404, "Jugador no encontrado")
    return p


def get_match(db: Session, owner_id: str, match_id: str) -> Match:
    m = db.get(Match, match_id)
    if not m or m.owner_id != owner_id:
        raise HTTPException(404, "Partida no encontrada")
    return m


def current_analysis(db: Session, match_id: str) -> Analysis | None:
    return db.scalar(select(Analysis).where(Analysis.match_id == match_id, Analysis.is_current.is_(True)).order_by(Analysis.created_at.desc()))


def player_out(p: Player) -> dict:
    return {
        "id": p.id, "name": p.name, "epic_id": p.epic_id, "platform": p.platform, "region": p.region,
        "game_mode": p.game_mode, "competitive_level": p.competitive_level, "coach_notes": p.coach_notes,
        "hud_calibrated": bool((p.hud_layout or {}).get("calibrated")),
        "created_at": iso(p.created_at), "updated_at": iso(p.updated_at),
    }


def media_out(m: MediaFile) -> dict:
    return {
        "id": m.id, "kind": m.kind, "original_name": m.original_name, "size_bytes": m.size_bytes, "mime": m.mime,
        "duration_s": m.duration_s, "width": m.width, "height": m.height, "fps": m.fps, "video_codec": m.video_codec,
        "audio_codec": m.audio_codec, "has_audio": m.has_audio, "meta": m.meta, "created_at": iso(m.created_at),
    }


def job_out(j: Job | None) -> dict | None:
    if not j:
        return None
    return {
        "id": j.id, "type": j.type, "status": j.status, "stage": j.stage, "progress": j.progress, "message": j.message,
        "error": j.error, "error_code": j.error_code, "attempts": j.attempts, "created_at": iso(j.created_at),
        "started_at": iso(j.started_at), "finished_at": iso(j.finished_at),
    }


def finding_out(f: Finding) -> dict:
    return {
        "id": f.id, "origin": f.origin, "module": f.module, "category": f.category, "error_type": f.error_type,
        "severity": f.severity, "phase": f.phase, "t_start": f.t_start, "t_end": f.t_end, "title": f.title,
        "what_happened": f.what_happened, "why_error": f.why_error, "what_to_do": f.what_to_do,
        "how_to_avoid": f.how_to_avoid, "evidence": f.evidence, "confidence": f.confidence,
        "review_status": f.review_status, "created_at": iso(f.created_at),
    }


def finding_dict_for_score(f: Finding) -> dict:
    return {"category": f.category, "severity": f.severity, "confidence": f.confidence if f.origin != "coach" else 1.0, "review_status": f.review_status}


def match_out(m: Match, *, media: list[MediaFile] | None = None, job: Job | None = None, analysis: Analysis | None = None) -> dict:
    out = {
        "id": m.id, "player_id": m.player_id, "player_name": m.player.name if m.player else None, "title": m.title,
        "source_type": m.source_type, "status": m.status, "game_mode": m.game_mode, "played_at": iso(m.played_at),
        "notes": m.notes, "target_player_ref": m.target_player_ref, "replay_video_offset": m.replay_video_offset,
        "created_at": iso(m.created_at), "updated_at": iso(m.updated_at),
    }
    if media is not None:
        out["media"] = [media_out(x) for x in media]
    if job is not None or media is not None:
        out["job"] = job_out(job)
    if analysis is not None:
        out["analysis"] = {"id": analysis.id, "overall": (analysis.scores or {}).get("overall"), "created_at": iso(analysis.created_at)}
    return out
