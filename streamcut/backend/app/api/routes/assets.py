"""Importación de vídeos (subidas reanudables por trozos), fuentes, candidatos y trabajos."""

from __future__ import annotations

import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, audit, current_principal
from app.core.config import get_settings
from app.db.models import (
    AnalysisJob,
    Clip,
    Export,
    HighlightCandidate,
    IngestionJob,
    MediaAsset,
    SourceAsset,
    TranscriptSegment,
    utcnow,
)
from app.db.session import get_db
from app.media.ffmpeg import ALLOWED_EXTENSIONS
from app.services.jobs import JOB_MODELS, job_dict, request_cancel
from app.services.pipeline import create_clip_from_candidate, import_chat_log
from app.services.retention import QuotaExceeded, check_quota
from app.services.settings import get_settings_data
from app.storage import get_storage, sha256_file
from app.workers.dispatch import enqueue_analysis, enqueue_export, enqueue_ingestion

router = APIRouter(tags=["assets"])
SAFE_NAME = re.compile(r"[^\w.\- ]+", re.UNICODE)


class UploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=300)
    size: int = Field(gt=0)
    title: str | None = Field(None, max_length=300)
    streamer_name: str | None = Field(None, max_length=200)
    game: str | None = Field(None, max_length=200)


class CompleteIn(BaseModel):
    auto_analyze: bool = True
    mode: Literal["highlights", "edit"] = "highlights"  # edit = Editor IA: editar el vídeo completo
    options: dict[str, Any] | None = None


class AnalyzeIn(BaseModel):
    duration_mode: Literal["auto", "15", "30", "45", "60", "custom"] | None = None
    custom_duration: float | None = Field(None, ge=5, le=600)
    sensitivity: float | None = Field(None, ge=0.3, le=3)
    max_candidates: int | None = Field(None, ge=1, le=100)
    min_score: float | None = Field(None, ge=0, le=100)
    categories: list[str] | None = None
    max_clips: int | None = Field(None, ge=0, le=100)
    force: bool = False
    no_clips: bool = False


def _asset(db: Session, p: Principal, asset_id: uuid.UUID, include_deleted: bool = False) -> SourceAsset:
    q = select(SourceAsset).where(SourceAsset.id == asset_id, SourceAsset.workspace_id == p.workspace_id)
    if not include_deleted:
        q = q.where(SourceAsset.deleted_at.is_(None))
    a = db.scalar(q)
    if a is None:
        raise HTTPException(404, "Vídeo no encontrado")
    return a


def media_url(m: MediaAsset | None) -> str | None:
    return f"/api/media/{m.id}" if m else None


def asset_out(db: Session, a: SourceAsset, detail: bool = False) -> dict[str, Any]:
    media = {m.kind: m for m in db.scalars(select(MediaAsset).where(MediaAsset.source_asset_id == a.id))}
    last_ing = db.scalar(select(IngestionJob).where(IngestionJob.source_asset_id == a.id)
                         .order_by(IngestionJob.created_at.desc()))
    last_an = db.scalar(select(AnalysisJob).where(AnalysisJob.source_asset_id == a.id)
                        .order_by(AnalysisJob.created_at.desc()))
    d = {"id": str(a.id), "title": a.title, "kind": a.kind, "status": a.status, "filename": a.original_filename,
         "size_bytes": a.size_bytes, "duration": a.duration, "width": a.width, "height": a.height, "fps": a.fps,
         "has_audio": a.has_audio, "created_at": a.created_at, "deleted_at": a.deleted_at,
         "streamer_name": a.streamer_name, "game": a.game, "has_chat": bool(a.chat_log),
         "thumbnail_url": media_url(media.get("thumbnail")), "proxy_url": media_url(media.get("proxy")),
         "original_url": f"/api/media/source/{a.id}", "waveform_url": media_url(media.get("waveform")),
         "ingestion": job_dict("ingestion", last_ing) if last_ing else None,
         "analysis": job_dict("analysis", last_an) if last_an else None,
         "clips": db.scalar(select(func.count(Clip.id)).where(Clip.source_asset_id == a.id, Clip.deleted_at.is_(None)))}
    if detail:
        d["probe"] = a.probe
        d["candidates"] = [cand_out(c) for c in db.scalars(
            select(HighlightCandidate).where(HighlightCandidate.source_asset_id == a.id)
            .order_by(HighlightCandidate.score.desc()))]
    return d


def cand_out(c: HighlightCandidate) -> dict[str, Any]:
    return {"id": str(c.id), "start": c.start, "end": c.end, "peak_time": c.peak_time,
            "recommended_duration": c.recommended_duration, "score": c.score, "scores": c.scores,
            "category": c.category, "confidence": c.confidence, "explanation": c.explanation,
            "transcript_text": c.transcript_text, "status": c.status, "created_at": c.created_at}


# -- Subidas reanudables ------------------------------------------------------------------

@router.post("/uploads")
def create_upload(body: UploadIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    s = get_settings()
    ext = Path(body.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(422, "Formato no admitido. Usa MP4, MOV, MKV o WEBM")
    if body.size > s.max_upload_bytes:
        raise HTTPException(413, f"El archivo supera el máximo de {s.max_upload_bytes // 1024**3} GB")
    try:
        check_quota(db, p.workspace_id, body.size)
    except QuotaExceeded as exc:
        raise HTTPException(507, str(exc)) from exc
    aid = uuid.uuid4()
    name = SAFE_NAME.sub("_", Path(body.filename).name)[:200]
    a = SourceAsset(id=aid, workspace_id=p.workspace_id, kind="upload", status="uploading",
                    title=body.title or Path(name).stem, original_filename=name, expected_size=body.size,
                    upload_tmp_key=f"tmp/uploads/{aid}.part", streamer_name=body.streamer_name, game=body.game)
    db.add(a)
    db.commit()
    return {"id": str(aid), "offset": 0, "size": body.size, "chunk_size": min(s.upload_chunk_max_bytes, 8 * 1024**2)}


def _uploading(db: Session, p: Principal, upload_id: uuid.UUID) -> SourceAsset:
    a = _asset(db, p, upload_id)
    if a.status != "uploading":
        raise HTTPException(409, "La subida ya se completó")
    return a


@router.get("/uploads/{upload_id}")
def upload_status(upload_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = _uploading(db, p, upload_id)
    return {"id": str(a.id), "offset": get_storage().size(a.upload_tmp_key), "size": a.expected_size}


@router.put("/uploads/{upload_id}")
async def upload_chunk(upload_id: uuid.UUID, request: Request, offset: int = Query(ge=0),
                       p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    s = get_settings()
    a = _uploading(db, p, upload_id)
    storage = get_storage()
    current = storage.size(a.upload_tmp_key)
    if offset != current:
        raise HTTPException(409, {"message": "Offset incorrecto", "offset": current})
    tmpdir = s.data_dir / "tmp"
    tmpdir.mkdir(parents=True, exist_ok=True)
    received = 0
    with tempfile.NamedTemporaryFile(dir=tmpdir, delete=False) as tf:
        try:
            async for chunk in request.stream():
                received += len(chunk)
                if received > s.upload_chunk_max_bytes or current + received > (a.expected_size or 0):
                    raise HTTPException(413, "Trozo demasiado grande o excede el tamaño declarado")
                tf.write(chunk)
        except HTTPException:
            tf.close()
            os.unlink(tf.name)
            raise
    try:
        with open(tf.name, "rb") as f:
            new = storage.append(a.upload_tmp_key, f, offset)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    finally:
        os.unlink(tf.name)
    a.size_bytes = new
    db.commit()
    return {"offset": new, "size": a.expected_size}


@router.post("/uploads/{upload_id}/complete")
def complete_upload(upload_id: uuid.UUID, body: CompleteIn, request: Request,
                    p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = _uploading(db, p, upload_id)
    storage = get_storage()
    size = storage.size(a.upload_tmp_key)
    if size != a.expected_size:
        raise HTTPException(409, {"message": "La subida está incompleta", "offset": size})
    with storage.as_local(a.upload_tmp_key) as local:
        digest = sha256_file(local)
        dup = db.scalar(select(SourceAsset).where(SourceAsset.workspace_id == p.workspace_id,
                                                  SourceAsset.sha256 == digest, SourceAsset.deleted_at.is_(None),
                                                  SourceAsset.id != a.id))
        if dup is not None:
            storage.delete(a.upload_tmp_key)
            db.delete(a)
            db.commit()
            return {"duplicate": True, "asset": asset_out(db, dup)}
        key = f"ws/{p.workspace_id}/originals/{a.id}/{a.original_filename}"
        dest = storage.local_path(key)
        if dest is not None and get_settings().storage_backend == "local":
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(local, dest)
        else:
            storage.put_file(local, key)
            storage.delete(a.upload_tmp_key)
    a.storage_key, a.sha256, a.size_bytes, a.status, a.upload_tmp_key = key, digest, size, "uploaded", None
    job = IngestionJob(workspace_id=p.workspace_id, source_asset_id=a.id, auto_analyze=body.auto_analyze,
                       params={"mode": body.mode, "options": body.options or {}})
    db.add(job)
    db.commit()
    enqueue_ingestion(job.id)
    audit(db, p, "asset.upload", "source_asset", a.id, request, size=size)
    return {"duplicate": False, "asset": asset_out(db, a), "job": job_dict("ingestion", job)}


@router.delete("/uploads/{upload_id}")
def cancel_upload(upload_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = _uploading(db, p, upload_id)
    get_storage().delete(a.upload_tmp_key)
    db.delete(a)
    db.commit()
    return {"ok": True}


# -- Fuentes ---------------------------------------------------------------------------

@router.get("/assets")
def list_assets(deleted: bool = False, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(SourceAsset).where(SourceAsset.workspace_id == p.workspace_id, SourceAsset.status != "uploading")
    q = q.where(SourceAsset.deleted_at.is_not(None) if deleted else SourceAsset.deleted_at.is_(None))
    return [asset_out(db, a) for a in db.scalars(q.order_by(SourceAsset.created_at.desc()).limit(500))]


@router.get("/assets/{asset_id}")
def get_asset(asset_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return asset_out(db, _asset(db, p, asset_id), detail=True)


@router.post("/assets/{asset_id}/chat")
async def import_chat(asset_id: uuid.UUID, file: UploadFile = File(...), p: Principal = Depends(current_principal),
                      db: Session = Depends(get_db)):
    a = _asset(db, p, asset_id)
    raw = await file.read(50 * 1024**2 + 1)
    if len(raw) > 50 * 1024**2:
        raise HTTPException(413, "El registro de chat supera 50 MB")
    try:
        a.chat_log = import_chat_log(raw)
    except Exception as exc:
        raise HTTPException(422, f"Formato de chat no reconocido: {exc}") from exc
    db.commit()
    return {"messages": len(a.chat_log)}


@router.post("/assets/{asset_id}/analyze")
def analyze(asset_id: uuid.UUID, body: AnalyzeIn, p: Principal = Depends(current_principal),
            db: Session = Depends(get_db)):
    a = _asset(db, p, asset_id)
    if a.status != "ready":
        raise HTTPException(409, "El vídeo aún no está listo")
    running = db.scalar(select(AnalysisJob).where(AnalysisJob.source_asset_id == a.id,
                                                  AnalysisJob.status.in_(("queued", "running"))))
    if running:
        raise HTTPException(409, "Ya hay un análisis en curso para este vídeo")
    job = AnalysisJob(workspace_id=p.workspace_id, source_asset_id=a.id, kind="full",
                      params=body.model_dump(exclude_none=True))
    db.add(job)
    db.commit()
    enqueue_analysis(job.id)
    return job_dict("analysis", job)


@router.get("/assets/{asset_id}/transcript")
def transcript(asset_id: uuid.UUID, start: float | None = None, end: float | None = None,
               p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = _asset(db, p, asset_id, include_deleted=True)
    q = select(TranscriptSegment).where(TranscriptSegment.source_asset_id == a.id)
    if start is not None:
        q = q.where(TranscriptSegment.end > start)
    if end is not None:
        q = q.where(TranscriptSegment.start < end)
    return [{"start": s.start, "end": s.end, "text": s.text, "language": s.language, "confidence": s.confidence,
             "words": s.words} for s in db.scalars(q.order_by(TranscriptSegment.start))]


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: uuid.UUID, request: Request, p: Principal = Depends(current_principal),
                 db: Session = Depends(get_db)):
    a = _asset(db, p, asset_id)
    a.deleted_at = utcnow()
    for model in (IngestionJob, AnalysisJob):
        for j in db.scalars(select(model).where(model.source_asset_id == a.id, model.status.in_(("queued", "running")))):
            j.cancel_requested = True
    db.commit()
    audit(db, p, "asset.delete", "source_asset", a.id, request)
    return {"ok": True}


@router.post("/assets/{asset_id}/restore")
def restore_asset(asset_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = _asset(db, p, asset_id, include_deleted=True)
    a.deleted_at = None
    db.commit()
    return asset_out(db, a)


@router.post("/candidates/{candidate_id}/clip")
def clip_candidate(candidate_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = db.scalar(select(HighlightCandidate).where(HighlightCandidate.id == candidate_id,
                                                   HighlightCandidate.workspace_id == p.workspace_id))
    if c is None or c.source_asset_id is None:
        raise HTTPException(404, "Candidato no encontrado")
    if c.status == "clipped":
        raise HTTPException(409, "Este candidato ya tiene clip")
    a = _asset(db, p, c.source_asset_id)
    an = db.scalar(select(AnalysisJob).where(AnalysisJob.source_asset_id == a.id, AnalysisJob.status == "succeeded")
                   .order_by(AnalysisJob.created_at.desc()))
    res = an.result if an else {}
    clip = create_clip_from_candidate(db, c, a, get_settings_data(db, p.workspace_id)["clipping"],
                                      webcam=res.get("webcam_region"), faces=res.get("faces"), origin="manual")
    return {"id": str(clip.id)}


@router.post("/candidates/{candidate_id}/reject")
def reject_candidate(candidate_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = db.scalar(select(HighlightCandidate).where(HighlightCandidate.id == candidate_id,
                                                   HighlightCandidate.workspace_id == p.workspace_id))
    if c is None:
        raise HTTPException(404, "Candidato no encontrado")
    c.status = "rejected"
    db.commit()
    return cand_out(c)


# -- Trabajos --------------------------------------------------------------------------

@router.get("/jobs")
def list_jobs(kind: Literal["ingestion", "analysis", "export", "publication"] | None = None, status: str | None = None,
              limit: int = Query(100, le=500), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    out = []
    for k, model in JOB_MODELS.items():
        if kind and k != kind:
            continue
        q = select(model).where(model.workspace_id == p.workspace_id)
        if status:
            q = q.where(model.status == status)
        for j in db.scalars(q.order_by(model.created_at.desc()).limit(limit)):
            d = job_dict(k, j)
            if k in ("ingestion", "analysis") and getattr(j, "source_asset_id", None):
                a = db.get(SourceAsset, j.source_asset_id)
                d["title"] = a.title if a else None
            if k == "export":
                c = db.get(Clip, j.clip_id)
                d["title"] = c.title if c else None
            out.append(d)
    out.sort(key=lambda d: d["created_at"], reverse=True)
    return out[:limit]


@router.post("/jobs/{kind}/{job_id}/cancel")
def cancel_job(kind: Literal["ingestion", "analysis", "export", "publication"], job_id: uuid.UUID,
               p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    job = request_cancel(db, kind, job_id, p.workspace_id)
    if job is None:
        raise HTTPException(404, "Trabajo no encontrado")
    return job_dict(kind, job)


@router.post("/jobs/{kind}/{job_id}/retry")
def retry_job(kind: Literal["ingestion", "analysis", "export", "publication"], job_id: uuid.UUID,
              p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    model = JOB_MODELS[kind]
    job = db.scalar(select(model).where(model.id == job_id, model.workspace_id == p.workspace_id))
    if job is None:
        raise HTTPException(404, "Trabajo no encontrado")
    if job.status not in ("failed", "cancelled"):
        raise HTTPException(409, "Solo se pueden reintentar trabajos fallidos o cancelados")
    job.status, job.cancel_requested, job.error, job.progress = "queued", False, None, 0.0
    job.max_attempts = max(job.max_attempts, job.attempts + 1)
    db.commit()
    from app.workers.dispatch import enqueue_publication
    {"ingestion": enqueue_ingestion, "analysis": enqueue_analysis, "export": enqueue_export,
     "publication": enqueue_publication}[kind](job.id)
    return job_dict(kind, job)
