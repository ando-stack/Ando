"""Servicio de ficheros con control de acceso y soporte de Range (reproducción con seek)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.db.models import MediaAsset, SourceAsset
from app.db.session import get_db
from app.storage import get_storage

router = APIRouter(prefix="/media", tags=["media"])


def _serve(key: str, mime: str):
    storage = get_storage()
    url = storage.presigned_url(key)
    if url:
        return RedirectResponse(url)
    path = storage.local_path(key)
    if path is None or not path.exists():
        raise HTTPException(410, "El archivo ya no existe")
    resp = FileResponse(path, media_type=mime)
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp


@router.get("/source/{asset_id}")
def source(asset_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = db.scalar(select(SourceAsset).where(SourceAsset.id == asset_id, SourceAsset.workspace_id == p.workspace_id))
    if a is None or not a.storage_key:
        raise HTTPException(404, "No encontrado")
    return _serve(a.storage_key, a.mime or "video/mp4")


@router.get("/{media_id}")
def media(media_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    m = db.scalar(select(MediaAsset).where(MediaAsset.id == media_id, MediaAsset.workspace_id == p.workspace_id))
    if m is None:
        raise HTTPException(404, "No encontrado")
    return _serve(m.storage_key, m.mime)
