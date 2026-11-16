"""Colecciones y etiquetas de la biblioteca."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.db.models import Collection, Tag, clip_tags, collection_clips
from app.db.session import get_db

router = APIRouter(tags=["library"])


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)


def col_out(db: Session, c: Collection) -> dict:
    n = db.scalar(select(func.count()).select_from(collection_clips).where(collection_clips.c.collection_id == c.id))
    return {"id": str(c.id), "name": c.name, "description": c.description, "clips": n, "created_at": c.created_at}


@router.get("/collections")
def list_collections(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return [col_out(db, c) for c in db.scalars(select(Collection).where(Collection.workspace_id == p.workspace_id)
                                               .order_by(Collection.name))]


@router.post("/collections")
def create_collection(body: CollectionIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = Collection(workspace_id=p.workspace_id, name=body.name.strip(), description=body.description)
    db.add(c)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Ya existe una colección con ese nombre") from exc
    return col_out(db, c)


def _col(db: Session, p: Principal, cid: uuid.UUID) -> Collection:
    c = db.scalar(select(Collection).where(Collection.id == cid, Collection.workspace_id == p.workspace_id))
    if c is None:
        raise HTTPException(404, "Colección no encontrada")
    return c


@router.patch("/collections/{collection_id}")
def update_collection(collection_id: uuid.UUID, body: CollectionIn, p: Principal = Depends(current_principal),
                      db: Session = Depends(get_db)):
    c = _col(db, p, collection_id)
    c.name, c.description = body.name.strip(), body.description
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Ya existe una colección con ese nombre") from exc
    return col_out(db, c)


@router.delete("/collections/{collection_id}")
def delete_collection(collection_id: uuid.UUID, p: Principal = Depends(current_principal),
                      db: Session = Depends(get_db)):
    db.delete(_col(db, p, collection_id))  # los clips no se borran
    db.commit()
    return {"ok": True}


@router.get("/tags")
def list_tags(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.execute(select(Tag, func.count(clip_tags.c.clip_id)).outerjoin(clip_tags, clip_tags.c.tag_id == Tag.id)
                      .where(Tag.workspace_id == p.workspace_id).group_by(Tag.id).order_by(Tag.name))
    return [{"id": str(t.id), "name": t.name, "clips": n} for t, n in rows]
