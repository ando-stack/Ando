"""Clips: biblioteca, filtros, búsqueda, versiones, edición no destructiva, descargas."""

from __future__ import annotations

import csv
import io
import json
import re
import uuid
import zipfile
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import Principal, audit, current_principal
from app.api.routes.assets import cand_out, media_url
from app.db.models import (
    AnalysisJob,
    Channel,
    Clip,
    ClipVersion,
    Collection,
    EditOperation,
    EditProject,
    Export,
    HighlightCandidate,
    MediaAsset,
    Publication,
    SourceAsset,
    Tag,
    collection_clips,
    utcnow,
)
from app.db.session import get_db
from app.media.editspec import EditSpec
from app.services.jobs import job_dict
from app.services.pipeline import media_of, queue_render, words_in
from app.services.retention import purge_clip
from app.storage import get_storage

router = APIRouter(prefix="/clips", tags=["clips"])
SORTS = {"recent": Clip.created_at.desc(), "score": Clip.score.desc().nulls_last(), "oldest": Clip.created_at.asc(),
         "duration": (Clip.end - Clip.start).desc().nulls_last(), "title": Clip.title.asc()}


class ClipPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    status: Literal["approved", "rejected", "published", "pending"] | None = None
    is_favorite: bool | None = None
    tags: list[str] | None = Field(None, max_length=30)


class BulkIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class EditOpIn(BaseModel):
    op_type: str = Field(min_length=1, max_length=40)
    payload: dict[str, Any] = Field(default_factory=dict)
    spec: dict[str, Any]
    base_seq: int


class PublishIn(BaseModel):
    platforms: list[Literal["youtube", "tiktok", "instagram"]] = Field(min_length=1, max_length=3)
    title: str = Field(min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    privacy: Literal["public", "unlisted", "private", "friends"] = "public"


class SaveIn(BaseModel):
    note: str | None = Field(None, max_length=300)
    render: bool = True


def _clip(db: Session, p: Principal, clip_id: uuid.UUID, include_deleted: bool = False) -> Clip:
    q = select(Clip).where(Clip.id == clip_id, Clip.workspace_id == p.workspace_id)
    if not include_deleted:
        q = q.where(Clip.deleted_at.is_(None))
    c = db.scalar(q.options(selectinload(Clip.tags), selectinload(Clip.collections)))
    if c is None:
        raise HTTPException(404, "Clip no encontrado")
    return c


def _version_media(db: Session, v: ClipVersion | None) -> tuple[MediaAsset | None, MediaAsset | None]:
    if v is None:
        return None, None
    return (db.get(MediaAsset, v.render_asset_id) if v.render_asset_id else None,
            db.get(MediaAsset, v.thumbnail_asset_id) if v.thumbnail_asset_id else None)


def clip_out(db: Session, c: Clip, detail: bool = False) -> dict[str, Any]:
    v = db.get(ClipVersion, c.current_version_id) if c.current_version_id else None
    render, thumb = _version_media(db, v)
    if thumb is None and c.source_asset_id:
        thumb = media_of(db, c.source_asset_id, "thumbnail")
    duration = render.duration if render else (c.end - c.start if c.end is not None and c.start is not None
                                                else (c.platform_data or {}).get("duration"))
    d = {"id": str(c.id), "title": c.title, "status": c.status, "origin": c.origin, "score": c.score,
         "category": c.category, "format": (v.edit_spec.get("format") if v else c.format), "duration": duration,
         "start": c.start, "end": c.end, "is_favorite": c.is_favorite, "streamer_name": c.streamer_name,
         "platform": c.platform, "game": c.game, "stream_time": c.stream_time, "created_at": c.created_at,
         "updated_at": c.updated_at, "deleted_at": c.deleted_at,
         "channel_id": str(c.channel_id) if c.channel_id else None,
         "source_asset_id": str(c.source_asset_id) if c.source_asset_id else None,
         "thumbnail_url": media_url(thumb) or c.platform_thumbnail_url, "video_url": media_url(render),
         "download_url": f"/api/clips/{c.id}/download" if render else None,
         "platform_clip_url": c.platform_clip_url, "detection_latency_s": c.detection_latency_s,
         "ready_latency_s": (c.platform_data or {}).get("ready_latency_s"),
         "version": v.version_no if v else None, "version_status": v.status if v else None,
         "tags": [t.name for t in c.tags], "collections": [str(x.id) for x in c.collections]}
    if detail:
        cand = db.get(HighlightCandidate, c.candidate_id) if c.candidate_id else None
        d["candidate"] = cand_out(cand) if cand else None
        d["transcript_text"] = c.transcript_text
        d["platform_data"] = c.platform_data
        d["versions"] = []
        for ver in c.versions:
            r, t = _version_media(db, ver)
            d["versions"].append({"id": str(ver.id), "version_no": ver.version_no, "status": ver.status,
                                  "note": ver.note, "created_at": ver.created_at, "video_url": media_url(r),
                                  "thumbnail_url": media_url(t), "duration": r.duration if r else None,
                                  "size_bytes": r.size_bytes if r else None,
                                  "av_sync_diff": (r.meta or {}).get("av_sync_diff") if r else None,
                                  "is_current": ver.id == c.current_version_id})
        exps = db.scalars(select(Export).where(Export.clip_id == c.id).order_by(Export.created_at.desc()).limit(10))
        d["exports"] = [job_dict("export", e) for e in exps]
        src = db.get(SourceAsset, c.source_asset_id) if c.source_asset_id else None
        d["source"] = None if src is None else {"id": str(src.id), "title": src.title, "kind": src.kind,
                                                "duration": src.duration, "deleted": src.deleted_at is not None}
    return d


@router.get("")
def list_clips(q: str | None = Query(None, max_length=200), channel_id: uuid.UUID | None = None,
               platform: str | None = None, game: str | None = None, category: str | None = None,
               status: str | None = None, format: str | None = None, favorite: bool | None = None,
               min_score: float | None = None, max_score: float | None = None, min_duration: float | None = None,
               max_duration: float | None = None, date_from: datetime | None = None, date_to: datetime | None = None,
               tag: str | None = None, collection_id: uuid.UUID | None = None, source_asset_id: uuid.UUID | None = None,
               session_id: uuid.UUID | None = None, deleted: bool = False,
               sort: Literal["recent", "score", "oldest", "duration", "title"] = "recent",
               limit: int = Query(48, ge=1, le=200), offset: int = Query(0, ge=0),
               p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    conds = [Clip.workspace_id == p.workspace_id,
             Clip.deleted_at.is_not(None) if deleted else Clip.deleted_at.is_(None)]
    if q:
        like = f"%{q.strip()}%"
        tag_match = select(Tag.id).where(Tag.workspace_id == p.workspace_id, Tag.name.ilike(like))
        conds.append(or_(Clip.title.ilike(like), Clip.streamer_name.ilike(like), Clip.transcript_text.ilike(like),
                         Clip.game.ilike(like), Clip.tags.any(Tag.id.in_(tag_match))))
    if channel_id:
        conds.append(Clip.channel_id == channel_id)
    if platform:
        conds.append(Clip.platform == platform)
    if game:
        conds.append(Clip.game.ilike(f"%{game}%"))
    if category:
        conds.append(Clip.category == category)
    if status:
        conds.append(Clip.status.in_(status.split(",")))
    if format:
        conds.append(Clip.format == format)
    if favorite is not None:
        conds.append(Clip.is_favorite.is_(favorite))
    if min_score is not None:
        conds.append(Clip.score >= min_score)
    if max_score is not None:
        conds.append(Clip.score <= max_score)
    if min_duration is not None:
        conds.append((Clip.end - Clip.start) >= min_duration)
    if max_duration is not None:
        conds.append((Clip.end - Clip.start) <= max_duration)
    if date_from:
        conds.append(Clip.created_at >= date_from)
    if date_to:
        conds.append(Clip.created_at <= date_to)
    if tag:
        conds.append(Clip.tags.any(Tag.name == tag))
    if collection_id:
        conds.append(Clip.collections.any(Collection.id == collection_id))
    if source_asset_id:
        conds.append(Clip.source_asset_id == source_asset_id)
    if session_id:
        conds.append(Clip.stream_session_id == session_id)
    where = and_(*conds)
    total = db.scalar(select(func.count(Clip.id)).where(where))
    rows = db.scalars(select(Clip).where(where).options(selectinload(Clip.tags), selectinload(Clip.collections))
                      .order_by(SORTS[sort]).limit(limit).offset(offset))
    return {"total": total, "items": [clip_out(db, c) for c in rows]}


@router.get("/facets")
def facets(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    base = select(Clip).where(Clip.workspace_id == p.workspace_id, Clip.deleted_at.is_(None)).subquery()
    def distinct(col):
        return [r for r in db.scalars(select(col).distinct().where(col.is_not(None))) if r]
    return {"streamers": distinct(base.c.streamer_name), "games": distinct(base.c.game),
            "categories": distinct(base.c.category), "platforms": distinct(base.c.platform),
            "formats": distinct(base.c.format),
            "tags": [t.name for t in db.scalars(select(Tag).where(Tag.workspace_id == p.workspace_id).order_by(Tag.name))],
            "channels": [{"id": str(c.id), "name": c.display_name} for c in
                         db.scalars(select(Channel).where(Channel.workspace_id == p.workspace_id))]}


@router.get("/export-metadata")
def export_metadata(format: Literal["json", "csv"] = "json", p: Principal = Depends(current_principal),
                    db: Session = Depends(get_db)):
    rows = [clip_out(db, c) for c in db.scalars(select(Clip).where(Clip.workspace_id == p.workspace_id,
                                                                   Clip.deleted_at.is_(None))
                                                .options(selectinload(Clip.tags), selectinload(Clip.collections))
                                                .order_by(Clip.created_at.desc()))]
    if format == "json":
        return Response(json.dumps(rows, default=str, ensure_ascii=False, indent=2), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="streamcut-clips.json"'})
    buf = io.StringIO()
    cols = ["id", "title", "status", "score", "category", "format", "duration", "streamer_name", "platform", "game",
            "stream_time", "created_at", "is_favorite", "tags", "platform_clip_url"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({**r, "tags": ";".join(r["tags"])})
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="streamcut-clips.csv"'})


@router.get("/{clip_id}")
def get_clip(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return clip_out(db, _clip(db, p, clip_id, include_deleted=True), detail=True)


@router.patch("/{clip_id}")
def patch_clip(clip_id: uuid.UUID, body: ClipPatch, p: Principal = Depends(current_principal),
               db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    if body.title is not None:
        c.title = body.title.strip()
    if body.status is not None:
        c.status = body.status
    if body.is_favorite is not None:
        c.is_favorite = body.is_favorite
    if body.tags is not None:
        names = sorted({re.sub(r"\s+", " ", t.strip().lower())[:60] for t in body.tags if t.strip()})
        tags = []
        for n in names:
            t = db.scalar(select(Tag).where(Tag.workspace_id == p.workspace_id, Tag.name == n))
            if t is None:
                t = Tag(workspace_id=p.workspace_id, name=n)
                db.add(t)
            tags.append(t)
        c.tags = tags
    db.commit()
    return clip_out(db, c, detail=True)


@router.delete("/{clip_id}")
def delete_clip(clip_id: uuid.UUID, request: Request, p: Principal = Depends(current_principal),
                db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    c.deleted_at = utcnow()
    db.commit()
    audit(db, p, "clip.delete", "clip", c.id, request)
    return {"ok": True}


@router.post("/{clip_id}/restore")
def restore_clip(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id, include_deleted=True)
    c.deleted_at = None
    db.commit()
    return clip_out(db, c)


@router.delete("/{clip_id}/purge")
def purge(clip_id: uuid.UUID, request: Request, p: Principal = Depends(current_principal),
          db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id, include_deleted=True)
    if c.deleted_at is None:
        raise HTTPException(409, "Primero mueve el clip a la papelera")
    purge_clip(db, c)
    db.commit()
    audit(db, p, "clip.purge", "clip", clip_id, request)
    return {"ok": True}


def _file_response(m: MediaAsset, filename: str):
    storage = get_storage()
    url = storage.presigned_url(m.storage_key)
    if url:
        return RedirectResponse(url)
    path = storage.local_path(m.storage_key)
    if path is None or not path.exists():
        raise HTTPException(410, "El archivo ya no existe")
    return FileResponse(path, media_type=m.mime, filename=filename)


def _safe_filename(title: str, ext: str) -> str:
    base = re.sub(r"[^\w\- ]+", "", title, flags=re.UNICODE).strip()[:80] or "clip"
    return f"{base}.{ext}"


@router.get("/{clip_id}/download")
def download(clip_id: uuid.UUID, version: int | None = None, p: Principal = Depends(current_principal),
             db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    v = next((x for x in c.versions if x.version_no == version), None) if version else \
        db.get(ClipVersion, c.current_version_id) if c.current_version_id else None
    if v is None or v.render_asset_id is None:
        raise HTTPException(404, "Este clip aún no tiene un MP4 renderizado")
    m = db.get(MediaAsset, v.render_asset_id)
    if c.status in ("pending", "approved", "detected"):
        c.status = "exported"
        db.commit()
    return _file_response(m, _safe_filename(c.title, "mp4"))


@router.post("/download")
def bulk_download(body: BulkIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    storage = get_storage()
    items: list[tuple[str, MediaAsset]] = []
    used: set[str] = set()
    for cid in body.ids:
        c = db.scalar(select(Clip).where(Clip.id == cid, Clip.workspace_id == p.workspace_id, Clip.deleted_at.is_(None)))
        if c is None or not c.current_version_id:
            continue
        v = db.get(ClipVersion, c.current_version_id)
        if not v or not v.render_asset_id:
            continue
        name = _safe_filename(c.title, "mp4")
        i = 2
        while name in used:
            name = _safe_filename(f"{c.title} ({i})", "mp4")
            i += 1
        used.add(name)
        items.append((name, db.get(MediaAsset, v.render_asset_id)))
    if not items:
        raise HTTPException(404, "Ninguno de los clips tiene MP4 renderizado")

    def gen():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for name, m in items:
                with storage.as_local(m.storage_key) as path:
                    z.write(path, name)
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()
        yield buf.getvalue()

    return StreamingResponse(gen(), media_type="application/zip",
                             headers={"Content-Disposition": 'attachment; filename="streamcut-clips.zip"'})


@router.post("/{clip_id}/render")
def rerender(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    v = db.get(ClipVersion, c.current_version_id) if c.current_version_id else None
    if v is None:
        raise HTTPException(409, "El clip no tiene versión editable (clip de plataforma sin archivo)")
    exp = queue_render(db, c, v, priority=1)
    return job_dict("export", exp)


@router.post("/{clip_id}/versions/{version_id}/activate")
def activate_version(clip_id: uuid.UUID, version_id: uuid.UUID, p: Principal = Depends(current_principal),
                     db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    v = next((x for x in c.versions if x.id == version_id), None)
    if v is None:
        raise HTTPException(404, "Versión no encontrada")
    c.current_version_id = v.id
    c.format = v.edit_spec.get("format", c.format)
    db.commit()
    return clip_out(db, c, detail=True)


# -- Editor (edición no destructiva) ----------------------------------------------------

def _project(db: Session, c: Clip) -> EditProject:
    proj = db.scalar(select(EditProject).where(EditProject.clip_id == c.id))
    if proj is None:
        v = db.get(ClipVersion, c.current_version_id) if c.current_version_id else None
        if v is None:
            raise HTTPException(409, "Este clip no tiene un vídeo editable")
        proj = EditProject(clip_id=c.id, base_version_id=v.id, current_spec=v.edit_spec, head_seq=0)
        db.add(proj)
        db.commit()
    return proj


@router.get("/{clip_id}/edit")
def edit_state(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    proj = _project(db, c)
    spec = EditSpec.model_validate(proj.current_spec)
    src = db.get(SourceAsset, uuid.UUID(spec.source_asset_id))
    if src is None or src.workspace_id != p.workspace_id:
        raise HTTPException(410, "El vídeo original ya no existe")
    proxy = media_of(db, src.id, "proxy")
    wf = media_of(db, src.id, "waveform")
    first, last = min(s.start for s in spec.segments), max(s.end for s in spec.segments)
    ctx_a, ctx_b = max(0.0, first - 30), min(src.duration or last, last + 30)
    an = db.scalar(select(AnalysisJob).where(AnalysisJob.source_asset_id == src.id, AnalysisJob.status == "succeeded")
                   .order_by(AnalysisJob.created_at.desc()))
    ops = db.scalar(select(func.count(EditOperation.id)).where(EditOperation.edit_project_id == proj.id))
    return {"clip": clip_out(db, c), "spec": proj.current_spec, "head_seq": proj.head_seq, "operations": ops,
            "dirty": proj.current_spec != (db.get(ClipVersion, c.current_version_id).edit_spec
                                           if c.current_version_id else None),
            "source": {"id": str(src.id), "title": src.title, "duration": src.duration, "width": src.width,
                       "height": src.height, "video_url": media_url(proxy) or f"/api/media/source/{src.id}",
                       "waveform_url": media_url(wf), "context_start": ctx_a, "context_end": ctx_b,
                       "webcam_region": (an.result or {}).get("webcam_region") if an else None},
            "words": words_in(db, src.id, ctx_a, ctx_b)}


@router.post("/{clip_id}/edit/ops")
def apply_op(clip_id: uuid.UUID, body: EditOpIn, p: Principal = Depends(current_principal),
             db: Session = Depends(get_db)):
    """Guarda una operación de edición y el estado resultante (validado). El original nunca cambia."""
    c = _clip(db, p, clip_id)
    proj = _project(db, c)
    if body.base_seq != proj.head_seq:
        raise HTTPException(409, {"message": "El proyecto cambió en otra ventana", "head_seq": proj.head_seq})
    try:
        spec = EditSpec.model_validate(body.spec)
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json())) from exc
    current = EditSpec.model_validate(proj.current_spec)
    if spec.source_asset_id != current.source_asset_id:
        raise HTTPException(422, "No se puede cambiar el vídeo original de un clip")
    src = db.get(SourceAsset, uuid.UUID(spec.source_asset_id))
    if src and src.duration and any(s.end > src.duration + 0.05 for s in spec.segments):
        raise HTTPException(422, "Un segmento sobrepasa el final del vídeo original")
    proj.head_seq += 1
    db.add(EditOperation(edit_project_id=proj.id, seq=proj.head_seq, op_type=body.op_type, payload=body.payload))
    proj.current_spec = spec.model_dump(mode="json")
    if c.status in ("pending", "detected", "approved", "exported"):
        c.status = "editing"
    db.commit()
    return {"head_seq": proj.head_seq, "spec": proj.current_spec}


@router.get("/{clip_id}/edit/ops")
def list_ops(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    proj = _project(db, c)
    return [{"seq": o.seq, "op_type": o.op_type, "payload": o.payload, "created_at": o.created_at}
            for o in db.scalars(select(EditOperation).where(EditOperation.edit_project_id == proj.id)
                                .order_by(EditOperation.seq.desc()).limit(200))]


@router.post("/{clip_id}/edit/save")
def save_version(clip_id: uuid.UUID, body: SaveIn, p: Principal = Depends(current_principal),
                 db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    proj = _project(db, c)
    spec = EditSpec.model_validate(proj.current_spec)
    n = (db.scalar(select(func.max(ClipVersion.version_no)).where(ClipVersion.clip_id == c.id)) or 0) + 1
    v = ClipVersion(clip_id=c.id, version_no=n, edit_spec=spec.model_dump(mode="json"), status="draft",
                    note=body.note or "Edición manual")
    db.add(v)
    db.flush()
    c.current_version_id = v.id
    c.format = spec.format
    c.start = min(s.start for s in spec.segments)
    c.end = max(s.end for s in spec.segments)
    proj.base_version_id = v.id
    c.status = "pending"
    db.commit()
    exp = queue_render(db, c, v, priority=1) if body.render else None
    return {"clip": clip_out(db, c, detail=True), "export": job_dict("export", exp) if exp else None}


@router.post("/{clip_id}/edit/reset")
def reset_project(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    proj = _project(db, c)
    v = db.get(ClipVersion, c.current_version_id)
    proj.current_spec = v.edit_spec
    proj.head_seq += 1
    db.add(EditOperation(edit_project_id=proj.id, seq=proj.head_seq, op_type="reset", payload={"version": v.version_no}))
    db.commit()
    return {"head_seq": proj.head_seq, "spec": proj.current_spec}


# -- Colecciones (añadir/quitar clips) -----------------------------------------------------

@router.post("/{clip_id}/collections/{collection_id}")
def add_to_collection(clip_id: uuid.UUID, collection_id: uuid.UUID, p: Principal = Depends(current_principal),
                      db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    col = db.scalar(select(Collection).where(Collection.id == collection_id, Collection.workspace_id == p.workspace_id))
    if col is None:
        raise HTTPException(404, "Colección no encontrada")
    if col not in c.collections:
        c.collections.append(col)
        db.commit()
    return clip_out(db, c)


@router.delete("/{clip_id}/collections/{collection_id}")
def remove_from_collection(clip_id: uuid.UUID, collection_id: uuid.UUID, p: Principal = Depends(current_principal),
                           db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id)
    db.execute(collection_clips.delete().where(collection_clips.c.clip_id == c.id,
                                               collection_clips.c.collection_id == collection_id))
    db.commit()
    db.refresh(c)
    return clip_out(db, c)


# -- Publicación en redes sociales ------------------------------------------------------

@router.get("/{clip_id}/publications")
def publications(clip_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _clip(db, p, clip_id, include_deleted=True)
    rows = db.scalars(select(Publication).where(Publication.clip_id == c.id).order_by(Publication.created_at.desc()))
    return [job_dict("publication", x) for x in rows]


@router.post("/{clip_id}/publish")
def publish_clip(clip_id: uuid.UUID, body: PublishIn, request: Request, p: Principal = Depends(current_principal),
                 db: Session = Depends(get_db)):
    from app.services.publishing import connection, targets
    from app.workers.dispatch import enqueue_publication
    c = _clip(db, p, clip_id)
    v = db.get(ClipVersion, c.current_version_id) if c.current_version_id else None
    if v is None or v.render_asset_id is None or v.status != "ready":
        raise HTTPException(409, "El clip todavía no tiene un MP4 editado y renderizado para publicar")
    ready = {t["platform"]: t for t in targets(db, p.workspace_id)}
    missing = [ready[x]["label"] + ": " + (ready[x]["reason"] or "") for x in body.platforms if not ready[x]["ready"]]
    if missing:
        raise HTTPException(409, "No se puede publicar en " + "; ".join(missing))
    media = db.get(MediaAsset, v.render_asset_id)
    if "youtube" in body.platforms and media.duration and media.duration > 180:
        raise HTTPException(422, "YouTube Shorts admite vídeos de hasta 3 minutos")
    out = []
    for platform in body.platforms:
        conn = connection(db, p.workspace_id, platform)
        pub = Publication(workspace_id=p.workspace_id, clip_id=c.id, clip_version_id=v.id, connection_id=conn.id,
                          platform=platform, title=body.title.strip(), description=body.description,
                          privacy=body.privacy, priority=3)
        db.add(pub)
        db.flush()
        out.append(pub)
    db.commit()
    for pub in out:
        enqueue_publication(pub.id)
    audit(db, p, "clip.publish", "clip", c.id, request, platforms=body.platforms)
    return [job_dict("publication", x) for x in out]
