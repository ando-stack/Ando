"""Políticas de retención, cuotas y eliminación segura de datos."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Clip, MediaAsset, SourceAsset, Workspace, utcnow
from app.db.session import SessionLocal
from app.storage import cleanup_temp, get_storage

from .jobs import write_log
from .settings import get_settings_data

log = logging.getLogger(__name__)


class QuotaExceeded(Exception):
    pass


def storage_used(db: Session, workspace_id: uuid.UUID) -> int:
    a = db.scalar(select(func.coalesce(func.sum(SourceAsset.size_bytes), 0))
                  .where(SourceAsset.workspace_id == workspace_id)) or 0
    m = db.scalar(select(func.coalesce(func.sum(MediaAsset.size_bytes), 0))
                  .where(MediaAsset.workspace_id == workspace_id)) or 0
    return int(a) + int(m)


def check_quota(db: Session, workspace_id: uuid.UUID, incoming: int) -> None:
    ws = db.get(Workspace, workspace_id)
    if ws and storage_used(db, workspace_id) + incoming > ws.storage_quota_bytes:
        raise QuotaExceeded("Se superaría la cuota de almacenamiento del workspace")


def purge_clip(db: Session, clip: Clip) -> None:
    storage = get_storage()
    for v in clip.versions:
        for m in db.scalars(select(MediaAsset).where(MediaAsset.clip_version_id == v.id)):
            storage.delete(m.storage_key)
            db.delete(m)
    storage.delete_prefix(f"ws/{clip.workspace_id}/renders/{clip.id}")
    clip.current_version_id = None
    db.flush()
    db.delete(clip)


def purge_source(db: Session, asset: SourceAsset) -> None:
    storage = get_storage()
    if asset.storage_key:
        storage.delete(asset.storage_key)
    if asset.upload_tmp_key:
        storage.delete(asset.upload_tmp_key)
    storage.delete_prefix(f"ws/{asset.workspace_id}/derived/{asset.id}")
    storage.delete_prefix(f"ws/{asset.workspace_id}/originals/{asset.id}")
    db.delete(asset)


def run_retention() -> dict:
    removed = {"clips": 0, "sources": 0, "temp": cleanup_temp()}
    with SessionLocal() as db:
        for ws in db.scalars(select(Workspace)):
            cfg = get_settings_data(db, ws.id)["retention"]
            cutoff = utcnow() - timedelta(days=int(cfg.get("trash_days", 30)))
            for clip in db.scalars(select(Clip).where(Clip.workspace_id == ws.id, Clip.deleted_at.is_not(None),
                                                      Clip.deleted_at < cutoff)):
                purge_clip(db, clip)
                removed["clips"] += 1
            for asset in db.scalars(select(SourceAsset).where(SourceAsset.workspace_id == ws.id,
                                                              SourceAsset.deleted_at.is_not(None),
                                                              SourceAsset.deleted_at < cutoff)):
                purge_source(db, asset)
                removed["sources"] += 1
            days = int(cfg.get("keep_live_recordings_days", 14))
            if days > 0:
                old = utcnow() - timedelta(days=days)
                for asset in db.scalars(select(SourceAsset).where(
                        SourceAsset.workspace_id == ws.id, SourceAsset.kind == "live_recording",
                        SourceAsset.created_at < old)):
                    # Las grabaciones de directo con clips renderizados se pueden borrar: el clip final se conserva.
                    in_use = db.scalar(select(func.count(Clip.id)).where(Clip.source_asset_id == asset.id,
                                                                         Clip.status.in_(("editing",))))
                    if not in_use:
                        purge_source(db, asset)
                        removed["sources"] += 1
            db.commit()
    write_log(None, "maintenance", None, "info", f"Retención aplicada: {removed}")
    return removed
