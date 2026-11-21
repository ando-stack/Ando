"""HUD calibration API: per-player layout, video snapshot, live OCR test."""
from __future__ import annotations

import io
import shutil
import uuid

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..hud.layout import DEFAULT_PRESET, FIELDS, normalize_layout
from ..hud.reader import HudReader, ocr_available
from ..models import MediaFile, User
from ..security import current_user
from ..storage import materialize
from ..video import ffmpeg as ff
from .common import get_match, get_player

router = APIRouter(tags=["hud"])


class LayoutIn(BaseModel):
    name: str | None = None
    rects: dict[str, list[float] | None]
    calibrated: bool = True


@router.get("/hud/fields")
def fields():
    ok, why = ocr_available()
    return {"fields": FIELDS, "default": DEFAULT_PRESET, "ocr": {"available": ok, "detail": why}}


@router.get("/players/{player_id}/hud")
def get_layout(player_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    return normalize_layout(p.hud_layout)


@router.put("/players/{player_id}/hud")
def put_layout(player_id: str, body: LayoutIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    try:
        p.hud_layout = normalize_layout(body.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return p.hud_layout


@router.delete("/players/{player_id}/hud")
def reset_layout(player_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    p.hud_layout = None
    db.commit()
    return normalize_layout(None)


def _frame(db, user, match_id: str, t: float) -> np.ndarray:
    m = get_match(db, user.id, match_id)
    v = db.scalar(select(MediaFile).where(MediaFile.match_id == m.id, MediaFile.kind == "video")) or db.scalar(
        select(MediaFile).where(MediaFile.match_id == m.id, MediaFile.kind == "proxy"))
    if not v:
        raise HTTPException(400, "Esta partida no tiene vídeo")
    work = get_settings().tmp_dir / f"snap-{uuid.uuid4().hex}"
    work.mkdir(parents=True)
    try:
        src = materialize(v.storage_key, work, "src")
        t = max(0.0, min(float(t), (v.duration_s or 1) - 0.1))
        out = work / "f.jpg"
        if not ff.extract_frame(src, t, out, 1920):
            raise HTTPException(500, "No se pudo extraer el fotograma")
        return np.array(Image.open(out).convert("RGB"))
    finally:
        shutil.rmtree(work, ignore_errors=True)


@router.get("/matches/{match_id}/snapshot")
def snapshot(match_id: str, t: float = 0, db: Session = Depends(get_db), user: User = Depends(current_user)):
    img = Image.fromarray(_frame(db, user, match_id, t))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return Response(buf.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


class TestIn(BaseModel):
    match_id: str
    t: float = 0
    layout: LayoutIn


@router.post("/hud/test")
def test_layout(body: TestIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ok, why = ocr_available()
    if not ok:
        raise HTTPException(503, why)
    try:
        layout = normalize_layout(body.layout.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e))
    frame = _frame(db, user, body.match_id, body.t)
    s = HudReader({**layout, "calibrated": True}).read(frame, body.t)
    return {
        "t": body.t,
        "storm_fraction": round(s.storm, 3),
        "fields": {k: {"text": s.raw.get(k), "value": s.values.get(k), "confidence": s.conf.get(k)} for k in layout["rects"]},
    }
