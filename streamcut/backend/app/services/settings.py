"""Configuración por workspace (pesos de puntuación, detección, AUTO PILOT, retención)."""

from __future__ import annotations

import copy
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.scoring import DEFAULT_WEIGHTS
from app.db.models import Setting

DEFAULTS: dict[str, Any] = {
    "detection": {
        "duration_mode": "auto",
        "custom_duration": None,
        "sensitivity": 1.0,
        "max_candidates": 12,
        "min_score": 45.0,
        "categories": None,
        "weights": dict(DEFAULT_WEIGHTS),
        "transcription": True,
        "visual_analysis": True,
        "whisper_model": None,
    },
    "clipping": {
        "auto_create_clips": True,
        "max_clips_per_source": 8,
        "template_slug": "gaming-viral",
        "format": "9:16",
        "subtitles": True,
        "auto_edit": True,
        "auto_render": True,
    },
    "autopilot": {
        "enabled": False,
        "categories": None,
        "sensitivity": 1.0,
        "min_score": 55.0,
        "max_clips_per_stream": 20,
        "duration_mode": "auto",
        "format": "9:16",
        "template_slug": "gaming-viral",
        "subtitles": True,
        "auto_edit": True,
        "auto_save": True,
        "create_platform_clips": True,
        "clip_cooldown_s": 30,  # tiempo mínimo entre dos clips del mismo directo
        "clip_delay_s": 8,  # espera tras la reacción del chat para que el clip incluya el momento completo
        "storage_policy": "keep_renders",
    },
    "ai_editor": {
        "format": "9:16",
        "style": "gaming-viral",
        "subtitles": "key",
        "emotes": "few",
        "cut_silences": True,
        "zoom": True,
        "hook_title": True,
        "denoise": False,
    },
    "retention": {
        "trash_days": 30,
        "proxy_days": 0,  # 0 = conservar
        "live_buffer_minutes": 20,
        "keep_live_recordings_days": 14,
    },
}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def get_settings_data(db: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    row = db.scalar(select(Setting).where(Setting.workspace_id == workspace_id))
    return _merge(DEFAULTS, row.data if row else {})


def update_settings_data(db: Session, workspace_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
    row = db.scalar(select(Setting).where(Setting.workspace_id == workspace_id))
    if row is None:
        row = Setting(workspace_id=workspace_id, data={})
        db.add(row)
    unknown = set(patch) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"Secciones desconocidas: {', '.join(sorted(unknown))}")
    row.data = _merge(row.data or {}, patch)
    db.commit()
    return _merge(DEFAULTS, row.data)
