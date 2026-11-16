"""Configuración del workspace e información del sistema."""

from __future__ import annotations

import shutil
import subprocess
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.analysis import transcribe
from app.analysis.scoring import COMPONENT_LABELS
from app.api.deps import Principal, current_principal
from app.core.config import get_settings
from app.db.session import get_db
from app.integrations.twitch import get_twitch
from app.integrations.youtube import get_youtube
from app.media.ffmpeg import ffmpeg_bin
from app.services.retention import storage_used
from app.services.settings import get_settings_data, update_settings_data

router = APIRouter(tags=["settings"])


@router.get("/settings")
def read_settings(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"data": get_settings_data(db, p.workspace_id), "weight_labels": COMPONENT_LABELS}


@router.patch("/settings")
def patch_settings(patch: dict[str, Any], p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    det = patch.get("detection", {})
    w = det.get("weights")
    if w is not None:
        if not isinstance(w, dict) or any(k not in COMPONENT_LABELS or not 0 <= float(v) <= 1 for k, v in w.items()):
            raise HTTPException(422, "Pesos no válidos: claves conocidas y valores entre 0 y 1")
    try:
        return {"data": update_settings_data(db, p.workspace_id, patch), "weight_labels": COMPONENT_LABELS}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _ffmpeg_version() -> str | None:
    try:
        out = subprocess.run([ffmpeg_bin(), "-version"], capture_output=True, text=True, timeout=10).stdout
        return out.splitlines()[0] if out else None
    except Exception:
        return None


@router.get("/system")
def system(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    s = get_settings()
    du = shutil.disk_usage(s.data_dir) if s.data_dir.exists() else None
    dev, ctype = transcribe.device()
    return {
        "integrations": {
            "twitch": {"configured": get_twitch().configured},
            "youtube": {"configured": get_youtube().configured, "oauth": get_youtube().oauth_configured},
        },
        "processing": {"ffmpeg": _ffmpeg_version(), "whisper_available": transcribe.available(),
                       "whisper_model": s.whisper_model, "whisper_live_model": s.whisper_live_model,
                       "device": dev, "compute_type": ctype, "hw_encoder": s.hwaccel_encoder or None,
                       "run_mode": s.run_mode, "broker": s.broker},
        "storage": {"backend": s.storage_backend, "used_bytes": storage_used(db, p.workspace_id),
                    "quota_bytes": p.workspace.storage_quota_bytes,
                    "disk_free_bytes": du.free if du else None, "disk_total_bytes": du.total if du else None},
        "demo_mode": s.demo_mode,
    }
