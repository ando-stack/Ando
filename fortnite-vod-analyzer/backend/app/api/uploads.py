"""Resumable chunked uploads.

1. POST /uploads                -> validates name/size/type, returns id + chunk size
2. PUT  /uploads/{id}?offset=N  -> raw bytes of one chunk (resumable: GET tells the offset)
3. POST /uploads/{id}/complete  -> size + content validation (ffprobe / replay magic),
                                   SHA-256 de-duplication, move to storage, metadata.
"""
from __future__ import annotations

import hashlib
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..jobs import ACTIVE
from ..models import Job, MediaFile, Upload, User, log_activity
from ..replay.base import ReplayError
from ..replay.native import NativeEventsAdapter
from ..security import current_user
from ..storage import get_storage
from ..video import ffmpeg as ff
from .common import get_match, iso, media_out

router = APIRouter(prefix="/uploads", tags=["uploads"])

VIDEO_EXT = {".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".webm": "video/webm"}
REPLAY_EXT = {".replay": "application/octet-stream"}


class UploadIn(BaseModel):
    match_id: str
    filename: str = Field(min_length=1, max_length=300)
    size_bytes: int = Field(gt=0)
    kind: str = Field(pattern="^(video|replay)$")


def _part(upload_id: str) -> Path:
    d = get_settings().tmp_dir / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{upload_id}.part"


def _out(u: Upload) -> dict:
    return {"id": u.id, "match_id": u.match_id, "kind": u.kind, "filename": u.filename, "size_bytes": u.size_bytes,
            "chunk_bytes": u.chunk_bytes, "received_bytes": u.received_bytes, "status": u.status, "error": u.error,
            "media_id": u.media_id, "created_at": iso(u.created_at)}


def _get(db: Session, user: User, upload_id: str) -> Upload:
    u = db.get(Upload, upload_id)
    if not u or u.owner_id != user.id:
        raise HTTPException(404, "Subida no encontrada")
    return u


@router.post("")
def create_upload(body: UploadIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = get_settings()
    m = get_match(db, user.id, body.match_id)
    ext = Path(body.filename).suffix.lower()
    if body.kind == "video":
        if ext not in VIDEO_EXT:
            raise HTTPException(415, "Formato no permitido. Sube MP4, MOV, MKV o WEBM.")
        if body.size_bytes > s.max_video_bytes:
            raise HTTPException(413, f"El vídeo supera el máximo de {s.max_video_bytes // (1024 * 1024)} MB.")
    else:
        if ext not in REPLAY_EXT:
            raise HTTPException(415, "Las replays de Fortnite tienen extensión .replay")
        if body.size_bytes > s.max_replay_bytes:
            raise HTTPException(413, f"La replay supera el máximo de {s.max_replay_bytes // (1024 * 1024)} MB.")
        if m.source_type != "replay":
            raise HTTPException(400, "Esta partida es de vídeo; crea una partida de tipo Replay.")
    if db.scalar(select(Job).where(Job.match_id == m.id, Job.status.in_(ACTIVE))):
        raise HTTPException(409, "Hay un análisis en curso para esta partida.")
    u = Upload(owner_id=user.id, match_id=m.id, kind=body.kind, filename=Path(body.filename).name[:300], size_bytes=body.size_bytes,
               chunk_bytes=s.upload_chunk_bytes)
    db.add(u)
    db.commit()
    _part(u.id).write_bytes(b"")
    return _out(u)


@router.get("/{upload_id}")
def get_upload(upload_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _out(_get(db, user, upload_id))


@router.put("/{upload_id}")
async def put_chunk(upload_id: str, offset: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    u = _get(db, user, upload_id)
    if u.status != "open":
        raise HTTPException(409, f"La subida está {u.status}")
    if offset > u.received_bytes or offset < 0:
        raise HTTPException(409, f"Offset inesperado; continuar desde {u.received_bytes}")
    path = _part(u.id)
    written = 0
    with open(path, "r+b") as f:
        f.truncate(offset)  # allows re-sending a partially received chunk
        f.seek(offset)
        async for piece in request.stream():
            written += len(piece)
            if written > u.chunk_bytes or offset + written > u.size_bytes:
                f.truncate(offset)
                raise HTTPException(413, "Chunk demasiado grande")
            f.write(piece)
    u.received_bytes = offset + written
    db.commit()
    return {"received_bytes": u.received_bytes}


@router.delete("/{upload_id}")
def abort_upload(upload_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    u = _get(db, user, upload_id)
    _part(u.id).unlink(missing_ok=True)
    if u.status == "open":
        u.status = "aborted"
    db.commit()
    return _out(u)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _fail(db, u: Upload, msg: str, status: int = 422):
    u.status, u.error = "failed", msg
    _part(u.id).unlink(missing_ok=True)
    db.commit()
    raise HTTPException(status, msg)


@router.post("/{upload_id}/complete")
def complete(upload_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = get_settings()
    u = _get(db, user, upload_id)
    if u.status == "complete":
        return {"upload": _out(u), "media": media_out(db.get(MediaFile, u.media_id))}
    if u.status != "open":
        raise HTTPException(409, f"La subida está {u.status}")
    path = _part(u.id)
    if not path.exists() or path.stat().st_size != u.size_bytes:
        raise HTTPException(409, f"Faltan datos: recibidos {path.stat().st_size if path.exists() else 0} de {u.size_bytes} bytes")
    m = get_match(db, user.id, u.match_id)
    digest = _sha256(path)
    dup = db.scalar(select(MediaFile).where(MediaFile.owner_id == user.id, MediaFile.sha256 == digest, MediaFile.kind == u.kind))
    if dup:
        dup_match = dup.match_id
        msg = "Este archivo ya está subido en otra partida." if dup_match != m.id else "Este archivo ya está subido en esta partida."
        u.status, u.error = "failed", msg
        path.unlink(missing_ok=True)
        db.commit()
        raise HTTPException(409, {"message": msg, "existing_match_id": dup_match})

    ext = Path(u.filename).suffix.lower()
    meta: dict = {}
    if u.kind == "video":
        try:
            info = ff.probe(path)
        except ff.VideoError as e:
            _fail(db, u, e.message, 415)
        if info.duration > s.max_video_seconds:
            _fail(db, u, f"El vídeo dura más de {s.max_video_seconds // 60} minutos (límite configurado).", 413)
        fields = dict(mime=VIDEO_EXT[ext], duration_s=info.duration, width=info.width, height=info.height, fps=info.fps,
                      video_codec=info.video_codec, audio_codec=info.audio_codec, has_audio=info.has_audio)
        meta = {"container": info.format_name, "bitrate": info.bitrate, "browser_playable": info.browser_playable}
    else:
        try:
            v = NativeEventsAdapter().probe(str(path))
        except ReplayError as e:
            _fail(db, u, f"Replay no válida: {e.message}", 415)
        fields = dict(mime=REPLAY_EXT[ext])
        meta = {"branch": v.branch, "season": v.season_label, "engine_network_version": v.engine_network_version,
                "file_version": v.file_version, "network_version": v.network_version, "changelist": v.changelist}

    # replace previous file of the same kind for this match
    st = get_storage()
    for old in db.scalars(select(MediaFile).where(MediaFile.match_id == m.id, MediaFile.kind.in_([u.kind] + (["proxy"] if u.kind == "video" else [])))):
        st.delete(old.storage_key)
        db.delete(old)
    db.flush()
    key = f"{user.id}/{m.id}/{uuid.uuid4().hex}{ext}"
    st.put_file(path, key, fields.get("mime"))
    media = MediaFile(owner_id=user.id, match_id=m.id, kind=u.kind, storage_key=key, original_name=u.filename,
                      size_bytes=u.size_bytes, sha256=digest, meta=meta, **fields)
    db.add(media)
    db.flush()
    u.status, u.media_id = "complete", media.id
    if u.kind == "video" and m.source_type == "replay":
        # Replay converted to video with Fortnite Replay Mode: analyse the recording.
        m.source_type = "video"
    m.status = "uploaded"
    log_activity(db, user.id, "file_uploaded", f"Archivo subido a {m.title}: {u.filename}", match_id=m.id, player_id=m.player_id)
    db.commit()
    shutil.rmtree(path, ignore_errors=True) if path.is_dir() else path.unlink(missing_ok=True)
    return {"upload": _out(u), "media": media_out(media)}
