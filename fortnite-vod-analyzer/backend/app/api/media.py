"""Media delivery: HTTP Range streaming for the VOD player and evidence frames.
Access uses short-lived signed tokens scoped to one file/analysis."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Analysis, Frame, MediaFile, User
from ..security import current_user, issue_media_token, verify_media_token
from ..storage import get_storage

router = APIRouter(tags=["media"])


@router.get("/media/{media_id}/url")
def media_url(media_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = db.get(MediaFile, media_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Archivo no encontrado")
    # Prefer the browser-playable proxy for video
    play = m
    if m.kind == "video" and not (m.meta or {}).get("browser_playable", True):
        proxy = db.scalar(select(MediaFile).where(MediaFile.match_id == m.match_id, MediaFile.kind == "proxy"))
        if not proxy:
            return {"url": None, "reason": "Este formato no se reproduce en el navegador; la versión reproducible se genera al analizar."}
        play = proxy
    token = issue_media_token(user.id, play.id)
    return {"url": f"{get_settings().public_api_url}/media/{play.id}/stream?token={token}", "media_id": play.id, "mime": play.mime}


def _iter_file(path, start: int, length: int, chunk: int = 1024 * 1024):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            data = f.read(min(chunk, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


@router.get("/media/{media_id}/stream")
def stream(media_id: str, token: str, request: Request, db: Session = Depends(get_db)):
    owner = verify_media_token(token, media_id)
    m = db.get(MediaFile, media_id)
    if not m or m.owner_id != owner:
        raise HTTPException(404, "Archivo no encontrado")
    st = get_storage()
    path = st.local_path(m.storage_key)
    if path is None:
        url = st.presigned_url(m.storage_key, 6 * 3600)
        if not url:
            raise HTTPException(404, "Archivo no disponible")
        return RedirectResponse(url)
    size = os.path.getsize(path)
    headers = {"Accept-Ranges": "bytes", "Content-Type": m.mime or "application/octet-stream", "Cache-Control": "private, max-age=3600",
               "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline"}
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        a, _, b = rng[6:].split(",")[0].partition("-")
        try:
            if a == "":
                start, end = max(0, size - int(b)), size - 1
            else:
                start, end = int(a), (int(b) if b else size - 1)
        except ValueError:
            raise HTTPException(416, "Rango inválido")
        end = min(end, size - 1)
        if start > end or start >= size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        length = end - start + 1
        headers |= {"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)}
        return StreamingResponse(_iter_file(path, start, length), status_code=206, headers=headers)
    headers["Content-Length"] = str(size)
    return StreamingResponse(_iter_file(path, 0, size), headers=headers)


@router.get("/analyses/{analysis_id}/frames-token")
def frames_token(analysis_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = db.get(Analysis, analysis_id)
    if not a or a.owner_id != user.id:
        raise HTTPException(404, "Análisis no encontrado")
    return {"token": issue_media_token(user.id, analysis_id), "base": f"{get_settings().public_api_url}/analyses/{analysis_id}/frames"}


@router.get("/analyses/{analysis_id}/frames/{label}")
def frame_image(analysis_id: str, label: str, token: str, db: Session = Depends(get_db)):
    owner = verify_media_token(token, analysis_id)
    fr = db.scalar(select(Frame).where(Frame.analysis_id == analysis_id, Frame.label == label, Frame.owner_id == owner))
    if not fr:
        raise HTTPException(404, "Fotograma no encontrado")
    return Response(get_storage().read_bytes(fr.storage_key), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})
