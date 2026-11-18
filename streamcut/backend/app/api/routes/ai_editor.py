"""Editor IA: cola de clips enviados a editar automáticamente y sus resultados."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import Principal, audit, current_principal
from app.api.routes.clips import clip_out
from app.db.models import AnalysisJob, Clip, Export
from app.db.session import get_db
from app.services.ai_editor import DEFAULT_OPTIONS, editor_options
from app.services.jobs import job_dict
from app.workers.dispatch import enqueue_analysis

router = APIRouter(prefix="/ai-editor", tags=["ai-editor"])


class SendIn(BaseModel):
    clip_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    options: dict[str, Any] | None = None


@router.get("/options")
def options(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"options": editor_options(db, p.workspace_id), "defaults": DEFAULT_OPTIONS}


@router.post("/jobs")
def send(body: SendIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    accepted, rejected = [], []
    opts = {k: v for k, v in (body.options or {}).items() if k in DEFAULT_OPTIONS}
    for cid in body.clip_ids:
        c = db.scalar(select(Clip).where(Clip.id == cid, Clip.workspace_id == p.workspace_id, Clip.deleted_at.is_(None)))
        if c is None:
            rejected.append({"clip_id": str(cid), "reason": "Clip no encontrado"})
            continue
        if not c.source_asset_id:
            reason = ("Es un clip de Twitch sin vídeo: pulsa primero «Descargar el vídeo de Twitch»"
                      if c.platform_clip_url else "El clip no tiene vídeo propio")
            rejected.append({"clip_id": str(cid), "title": c.title, "reason": reason})
            continue
        busy = db.scalar(select(AnalysisJob.id).where(AnalysisJob.kind == "ai_edit",
                                                      AnalysisJob.status.in_(("queued", "running")),
                                                      AnalysisJob.params["clip_id"].as_string() == str(c.id)))
        if busy:
            rejected.append({"clip_id": str(cid), "title": c.title, "reason": "Ya se está editando"})
            continue
        job = AnalysisJob(workspace_id=p.workspace_id, source_asset_id=c.source_asset_id, kind="ai_edit",
                          params={"clip_id": str(c.id), "options": opts}, priority=3)
        db.add(job)
        c.status = "processing"
        db.commit()
        enqueue_analysis(job.id)
        accepted.append(job_dict("analysis", job))
    if accepted:
        audit(db, p, "ai_editor.send", "clip", None, request, count=len(accepted))
    return {"accepted": accepted, "rejected": rejected}


@router.get("/jobs")
def jobs(limit: int = Query(60, le=200), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(AnalysisJob).where(AnalysisJob.workspace_id == p.workspace_id,
                                                AnalysisJob.kind == "ai_edit")
                      .order_by(AnalysisJob.created_at.desc()).limit(limit))
    out = []
    for j in rows:
        clip = db.scalar(select(Clip).where(Clip.id == uuid.UUID(j.params.get("clip_id")))
                         .options(selectinload(Clip.tags), selectinload(Clip.collections))) \
            if j.params.get("clip_id") else None
        render = None
        if clip is not None and clip.current_version_id:
            exp = db.scalar(select(Export).where(Export.clip_version_id == clip.current_version_id)
                            .order_by(Export.created_at.desc()))
            render = job_dict("export", exp) if exp else None
        out.append({"job": job_dict("analysis", j), "render": render,
                    "clip": clip_out(db, clip) if clip is not None and clip.deleted_at is None else None})
    return out


@router.post("/jobs/{job_id}/retry")
def retry(job_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    j = db.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id, AnalysisJob.workspace_id == p.workspace_id,
                                            AnalysisJob.kind == "ai_edit"))
    if j is None:
        raise HTTPException(404, "Edición no encontrada")
    new = AnalysisJob(workspace_id=j.workspace_id, source_asset_id=j.source_asset_id, kind="ai_edit",
                      params=j.params, priority=3)
    db.add(new)
    db.commit()
    enqueue_analysis(new.id)
    return job_dict("analysis", new)
