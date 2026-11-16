"""Plantillas de edición predefinidas y aplicación de una plantilla a un clip."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import Template
from app.media.editspec import EditSpec, cues_from_words

# El "spec" de una plantilla es un EditSpec parcial (sin fuente ni segmentos) + reglas automáticas.
BUILTIN_TEMPLATES: list[dict[str, Any]] = [
    {
        "slug": "gaming-viral", "name": "Gaming Viral",
        "description": "Vertical, subtítulos dinámicos, zooms moderados, gameplay principal y webcam visible.",
        "spec": {
            "format": "9:16",
            "layout": {"mode": "split", "split_ratio": 0.36},
            "zoom": {"enabled": True, "auto_punch_in": True, "scale": 1.12},
            "subtitles": {"enabled": True, "style": {"font": "Inter", "size": 76, "bold": True, "uppercase": True,
                                                     "color": "#FFFFFF", "highlight_color": "#A78BFA",
                                                     "outline": 6, "shadow": 2, "position": "middle",
                                                     "animation": "pop", "words_per_line": 3}},
            "audio": {"normalize": True, "target_lufs": -14, "limiter": True},
        },
    },
    {
        "slug": "just-chatting", "name": "Just Chatting",
        "description": "Cara centrada, subtítulos grandes, cortes limpios y énfasis en la conversación.",
        "spec": {
            "format": "9:16",
            "layout": {"mode": "crop", "face_center": True},
            "zoom": {"enabled": False},
            "subtitles": {"enabled": True, "style": {"font": "Inter", "size": 84, "bold": True,
                                                     "color": "#FFFFFF", "highlight_color": "#FDE047",
                                                     "outline": 6, "shadow": 2, "position": "bottom",
                                                     "margin_v": 320, "animation": "karaoke",
                                                     "words_per_line": 4}},
            "audio": {"normalize": True, "target_lufs": -14, "limiter": True, "denoise": True},
        },
    },
    {
        "slug": "reaction", "name": "Reaction",
        "description": "La reacción es la protagonista: webcam arriba si existe, subtítulos y composición adaptativa.",
        "spec": {
            "format": "9:16",
            "layout": {"mode": "split", "split_ratio": 0.5},
            "zoom": {"enabled": True, "auto_punch_in": True, "scale": 1.18},
            "subtitles": {"enabled": True, "style": {"font": "Inter", "size": 72, "bold": True,
                                                     "color": "#FFFFFF", "highlight_color": "#F472B6",
                                                     "outline": 5, "shadow": 2, "position": "middle",
                                                     "animation": "pop", "words_per_line": 3}},
            "audio": {"normalize": True, "target_lufs": -14, "limiter": True},
        },
    },
    {
        "slug": "clean", "name": "Clean",
        "description": "Cortes mínimos, subtítulos discretos y sin efectos innecesarios.",
        "spec": {
            "format": "9:16",
            "layout": {"mode": "fit_blur"},
            "zoom": {"enabled": False},
            "subtitles": {"enabled": True, "style": {"font": "Inter", "size": 56, "bold": False,
                                                     "color": "#FFFFFF", "highlight_color": "#FFFFFF",
                                                     "outline": 3, "shadow": 1, "position": "bottom",
                                                     "margin_v": 220, "animation": "none",
                                                     "words_per_line": 6}},
            "audio": {"normalize": True, "target_lufs": -16, "limiter": True},
            "fades": {"video_in": 0.0, "video_out": 0.2},
        },
    },
    {
        "slug": "horizontal-raw", "name": "Horizontal original",
        "description": "16:9 sin reencuadre ni subtítulos (para YouTube o archivo).",
        "spec": {
            "format": "16:9",
            "layout": {"mode": "fit_black"},
            "zoom": {"enabled": False},
            "subtitles": {"enabled": False},
            "audio": {"normalize": True, "target_lufs": -14, "limiter": True},
        },
    },
]


def ensure_builtin_templates(db: Session) -> None:
    existing = {t.slug: t for t in db.scalars(select(Template).where(Template.workspace_id.is_(None)))}
    for tpl in BUILTIN_TEMPLATES:
        row = existing.get(tpl["slug"])
        if row is None:
            db.add(Template(workspace_id=None, slug=tpl["slug"], name=tpl["name"], description=tpl["description"],
                            is_builtin=True, spec=tpl["spec"]))
        else:
            row.name, row.description, row.spec = tpl["name"], tpl["description"], tpl["spec"]
    db.commit()


def get_template(db: Session, workspace_id: uuid.UUID, template_id: uuid.UUID | None = None,
                 slug: str | None = None) -> Template | None:
    q = select(Template).where(or_(Template.workspace_id == workspace_id, Template.workspace_id.is_(None)))
    if template_id:
        return db.scalar(q.where(Template.id == template_id))
    if slug:
        return db.scalar(q.where(Template.slug == slug).order_by(Template.workspace_id.is_(None)))
    return None


def build_spec(template_spec: dict[str, Any], *, source_asset_id: str, start: float, end: float,
               words: list[dict], peak: float | None, source_w: int | None, source_h: int | None,
               webcam: dict | None, faces: list | None = None, auto_edit: bool = True,
               format_override: str | None = None, subtitles_override: bool | None = None) -> EditSpec:
    """Crea el EditSpec automático de un clip a partir de una plantilla y del análisis."""
    t = template_spec
    layout = dict(t.get("layout", {}))
    face_center = layout.pop("face_center", False)
    fmt = format_override or t.get("format", "9:16")
    if layout.get("mode") == "split":
        if webcam:
            layout["webcam"] = {k: webcam[k] for k in ("x", "y", "w", "h")}
        else:
            # Sin webcam fiable: encuadre por defecto editable (vídeo completo con fondo difuminado)
            layout["mode"] = "fit_blur"
    if layout.get("mode") == "crop":
        if face_center and faces:
            fx = sorted(f[1] + f[3] / 2 for f in faces)[len(faces) // 2]
            w = min(1.0, ((source_h or 9) / (source_w or 16)) * 9 / 16) if fmt == "9:16" else 1.0
            layout["main"] = {"x": max(0.0, min(1 - w, fx - w / 2)), "y": 0.0, "w": w, "h": 1.0}
        elif not face_center:
            layout["main"] = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    zoom_cfg = dict(t.get("zoom", {}))
    punch = []
    if auto_edit and zoom_cfg.pop("auto_punch_in", False) and zoom_cfg.get("enabled") and peak is not None:
        rel = max(0.0, peak - start - 0.3)
        if rel < end - start - 1.0:
            punch.append({"t": round(rel, 2), "duration": min(2.0, end - start - rel - 0.5),
                          "scale": float(zoom_cfg.pop("scale", 1.12))})
    zoom_cfg.pop("scale", None)
    zoom_cfg["punch_ins"] = punch
    zoom_cfg["enabled"] = bool(zoom_cfg.get("enabled")) and bool(punch) and auto_edit
    subs = dict(t.get("subtitles", {"enabled": True}))
    style = subs.get("style", {})
    if subtitles_override is not None:
        subs["enabled"] = subtitles_override
    subs["cues"] = cues_from_words(words, start, end, style.get("words_per_line", 4)) if subs.get("enabled") else []
    if not auto_edit:
        layout = {"mode": "fit_blur"} if fmt != "16:9" else {"mode": "fit_black"}
        zoom_cfg = {"enabled": False, "punch_ins": []}
    return EditSpec.model_validate({
        "source_asset_id": source_asset_id,
        "segments": [{"start": round(start, 3), "end": round(end, 3)}],
        "format": fmt,
        "layout": layout,
        "zoom": zoom_cfg,
        "subtitles": subs,
        "audio": t.get("audio", {}),
        "fades": t.get("fades", {}),
        "auto_edit": auto_edit,
    })
