from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..analysis.replay_pipeline import replay_players
from ..config import get_settings
from ..db import get_db
from ..jobs import ACTIVE, enqueue
from ..models import Job, Match, MediaFile, User, log_activity
from ..replay.base import ReplayError
from ..replay.registry import parse_replay
from ..security import current_user
from ..storage import get_storage, materialize
from .common import current_analysis, get_match, get_player, job_out, match_out

router = APIRouter(prefix="/matches", tags=["matches"])


class MatchIn(BaseModel):
    player_id: str
    title: str = Field(min_length=1, max_length=200)
    source_type: str = Field(pattern="^(video|replay)$")
    game_mode: str | None = Field(default=None, max_length=60)
    played_at: dt.datetime | None = None
    notes: str | None = Field(default=None, max_length=10000)


class MatchPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    game_mode: str | None = Field(default=None, max_length=60)
    played_at: dt.datetime | None = None
    notes: str | None = Field(default=None, max_length=10000)
    target_player_ref: str | None = Field(default=None, max_length=120)
    replay_video_offset: float | None = None


def _media(db, match_id):
    return db.scalars(select(MediaFile).where(MediaFile.match_id == match_id).order_by(MediaFile.created_at)).all()


def _job(db, match_id):
    return db.scalar(select(Job).where(Job.match_id == match_id).order_by(Job.created_at.desc()))


@router.get("")
def list_matches(player_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Match).where(Match.owner_id == user.id).order_by(Match.created_at.desc())
    if player_id:
        q = q.where(Match.player_id == player_id)
    return [match_out(m, analysis=current_analysis(db, m.id)) for m in db.scalars(q).all()]


@router.post("")
def create_match(body: MatchIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, body.player_id)
    m = Match(owner_id=user.id, player_id=p.id, title=body.title, source_type=body.source_type, game_mode=body.game_mode or p.game_mode,
              played_at=body.played_at, notes=body.notes, status="draft")
    db.add(m)
    db.flush()
    log_activity(db, user.id, "match_created", f"Nueva partida ({'vídeo' if m.source_type == 'video' else 'replay'}): {m.title}", match_id=m.id, player_id=p.id)
    db.commit()
    return match_out(m, media=[], job=None)


@router.get("/{match_id}")
def get_match_detail(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    return match_out(m, media=_media(db, m.id), job=_job(db, m.id), analysis=current_analysis(db, m.id))


@router.patch("/{match_id}")
def update_match(match_id: str, body: MatchPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    return match_out(m, media=_media(db, m.id), job=_job(db, m.id))


@router.delete("/{match_id}")
def delete_match(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    for j in db.scalars(select(Job).where(Job.match_id == m.id, Job.status.in_(ACTIVE))):
        j.status = "cancelled"
    db.commit()
    get_storage().delete_prefix(f"{user.id}/{m.id}")
    log_activity(db, user.id, "match_deleted", f"Partida eliminada: {m.title}", player_id=m.player_id)
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.delete("/{match_id}/media/{media_id}")
def delete_media(match_id: str, media_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Delete the uploaded video/replay (and its playback proxy). Analyses are kept."""
    m = get_match(db, user.id, match_id)
    if db.scalar(select(Job).where(Job.match_id == m.id, Job.status.in_(ACTIVE))):
        raise HTTPException(409, "Hay un análisis en curso; cancélalo antes de borrar el archivo")
    target = db.get(MediaFile, media_id)
    if not target or target.match_id != m.id:
        raise HTTPException(404, "Archivo no encontrado")
    victims = [target]
    if target.kind == "video":
        victims += db.scalars(select(MediaFile).where(MediaFile.match_id == m.id, MediaFile.kind == "proxy")).all()
    st = get_storage()
    for v in victims:
        st.delete(v.storage_key)
        db.delete(v)
    if m.status in ("uploaded", "draft", "failed", "incompatible") and not current_analysis(db, m.id):
        m.status = "draft"
    log_activity(db, user.id, "media_deleted", f"Archivo eliminado de {m.title}: {target.original_name}", match_id=m.id, player_id=m.player_id)
    db.commit()
    return {"ok": True}


@router.post("/{match_id}/analyze")
def analyze(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    kind = "video" if m.source_type == "video" else "replay"
    media = db.scalar(select(MediaFile).where(MediaFile.match_id == m.id, MediaFile.kind == kind))
    if not media:
        raise HTTPException(400, "Sube primero el archivo de la partida")
    active = db.scalar(select(Job).where(Job.match_id == m.id, Job.status.in_(ACTIVE)))
    if active:
        return {"job": job_out(active), "duplicate": True}
    job = enqueue(db, owner_id=user.id, match=m, job_type=f"analyze_{kind}")
    log_activity(db, user.id, "analysis_queued", f"Análisis en cola: {m.title}", match_id=m.id, player_id=m.player_id)
    db.commit()
    return {"job": job_out(job), "duplicate": False}


@router.post("/{match_id}/cancel")
def cancel(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    job = db.scalar(select(Job).where(Job.match_id == m.id, Job.status.in_(ACTIVE)))
    if not job:
        raise HTTPException(404, "No hay análisis en curso")
    was_queued = job.status == "queued"
    job.status = "cancelled"
    job.message = "Cancelado por el usuario"
    if was_queued:
        m.status = "uploaded"
    db.commit()
    return {"job": job_out(job)}


@router.get("/{match_id}/job")
def job_status(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    return {"match_status": m.status, "job": job_out(_job(db, m.id))}


@router.get("/{match_id}/replay/players")
def replay_candidates(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Parse the replay (fast) to let the coach pick which player to analyse."""
    m = get_match(db, user.id, match_id)
    rep = db.scalar(select(MediaFile).where(MediaFile.match_id == m.id, MediaFile.kind == "replay"))
    if not rep:
        raise HTTPException(400, "La partida no tiene replay")
    work = get_settings().tmp_dir / f"probe-{m.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        path = materialize(rep.storage_key, work, "probe.replay")
        r = parse_replay(str(path))
    except ReplayError as e:
        return {"compatible": False, "error": e.message, "code": e.code, "players": []}
    finally:
        import shutil

        shutil.rmtree(work, ignore_errors=True)
    return {
        "compatible": True,
        "adapter": r.adapter,
        "version": {"branch": r.version.branch, "season": r.version.season_label, "engine_network_version": r.version.engine_network_version},
        "length_s": round(r.length_ms / 1000, 1),
        "owner_ref": r.owner_id,
        "unavailable": r.unavailable,
        "warnings": r.warnings,
        "players": replay_players(r),
    }
