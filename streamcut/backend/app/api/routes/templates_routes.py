"""Plantillas de edición: predefinidas (solo lectura) y del usuario."""

from __future__ import annotations

import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.db.models import Template
from app.db.session import get_db
from app.services.templates import build_spec

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    spec: dict[str, Any]


def tpl_out(t: Template) -> dict:
    return {"id": str(t.id), "slug": t.slug, "name": t.name, "description": t.description, "is_builtin": t.is_builtin,
            "spec": t.spec, "updated_at": t.updated_at}


def _validate(spec: dict[str, Any]) -> None:
    """Comprueba que la plantilla produce un EditSpec válido."""
    try:
        build_spec(spec, source_asset_id=str(uuid.uuid4()), start=0, end=20, words=[], peak=5, source_w=1920,
                   source_h=1080, webcam={"x": 0.7, "y": 0.7, "w": 0.25, "h": 0.25})
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(422, f"Plantilla no válida: {exc}") from exc


def _slug(name: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "plantilla")[:60]


@router.get("")
def list_templates(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(Template).where(or_(Template.workspace_id == p.workspace_id,
                                                 Template.workspace_id.is_(None)))
                      .order_by(Template.is_builtin.desc(), Template.name))
    return [tpl_out(t) for t in rows]


@router.post("")
def create_template(body: TemplateIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    _validate(body.spec)
    slug = base = _slug(body.name)
    i = 2
    while db.scalar(select(Template).where(Template.workspace_id == p.workspace_id, Template.slug == slug)) or \
            db.scalar(select(Template).where(Template.workspace_id.is_(None), Template.slug == slug)):
        slug = f"{base}-{i}"
        i += 1
    t = Template(workspace_id=p.workspace_id, slug=slug, name=body.name, description=body.description,
                 spec=body.spec, is_builtin=False)
    db.add(t)
    db.commit()
    return tpl_out(t)


def _own(db: Session, p: Principal, tid: uuid.UUID) -> Template:
    t = db.get(Template, tid)
    if t is None or t.workspace_id not in (p.workspace_id, None):
        raise HTTPException(404, "Plantilla no encontrada")
    return t


@router.put("/{template_id}")
def update_template(template_id: uuid.UUID, body: TemplateIn, p: Principal = Depends(current_principal),
                    db: Session = Depends(get_db)):
    t = _own(db, p, template_id)
    if t.is_builtin:
        raise HTTPException(403, "Las plantillas predefinidas no se modifican: duplícala")
    _validate(body.spec)
    t.name, t.description, t.spec = body.name, body.description, body.spec
    db.commit()
    return tpl_out(t)


@router.post("/{template_id}/duplicate")
def duplicate(template_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    t = _own(db, p, template_id)
    return create_template(TemplateIn(name=f"{t.name} (copia)", description=t.description, spec=t.spec), p, db)


@router.delete("/{template_id}")
def delete_template(template_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    t = _own(db, p, template_id)
    if t.is_builtin:
        raise HTTPException(403, "Las plantillas predefinidas no se pueden borrar")
    db.delete(t)
    db.commit()
    return {"ok": True}
