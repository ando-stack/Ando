"""Publicación de clips en redes sociales (cola «publish»)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decrypt, encrypt
from app.db.models import ChannelConnection, Clip, ClipVersion, MediaAsset, Publication, utcnow
from app.db.session import SessionLocal
from app.integrations.publishing import InstagramClient, PublishError, TikTokClient, youtube_upload
from app.integrations.youtube import get_youtube
from app.storage import get_storage

from .bus import publish
from .channels import valid_user_token
from .jobs import JobContext

log = logging.getLogger(__name__)
PLATFORM_LABELS = {"youtube": "YouTube Shorts", "tiktok": "TikTok", "instagram": "Instagram Reels"}


def connection(db: Session, workspace_id: uuid.UUID, platform: str) -> ChannelConnection | None:
    return db.scalar(select(ChannelConnection).where(
        ChannelConnection.workspace_id == workspace_id, ChannelConnection.platform == platform,
        ChannelConnection.kind == "oauth_user", ChannelConnection.status.in_(("active", "expired")))
        .order_by(ChannelConnection.created_at.desc()))


def targets(db: Session, workspace_id: uuid.UUID) -> list[dict[str, Any]]:
    """Estado real de cada destino: app configurada en .env y cuenta conectada (con permiso de subida)."""
    out = []
    configured = {"youtube": get_youtube().oauth_configured, "tiktok": TikTokClient().configured,
                  "instagram": InstagramClient().configured}
    for platform, label in PLATFORM_LABELS.items():
        conn = connection(db, workspace_id, platform)
        can_upload = conn is not None and (
            platform != "youtube" or "https://www.googleapis.com/auth/youtube.upload" in (conn.scopes or []))
        reason = None
        if not configured[platform] and not conn:
            reason = "Falta configurar la app de desarrollador en el archivo .env"
        elif conn is None:
            reason = "Conecta la cuenta en Configuración"
        elif not can_upload:
            reason = "Vuelve a conectar YouTube para conceder el permiso de subida"
        out.append({"platform": platform, "label": label, "configured": configured[platform],
                    "connected": conn is not None, "account": conn.external_login if conn else None,
                    "ready": can_upload, "reason": reason})
    return out


def _token(db: Session, conn: ChannelConnection) -> str:
    if conn.platform == "youtube":
        token = valid_user_token(db, conn)
        if not token:
            raise PublishError("La autorización de YouTube caducó: vuelve a conectar la cuenta")
        return token
    token = decrypt(conn.access_token_enc)
    exp = conn.expires_at
    if exp is not None and exp.tzinfo is None:
        from datetime import timezone
        exp = exp.replace(tzinfo=timezone.utc)
    soon = 7 * 86400 if conn.platform == "instagram" else 300
    if token and (exp is None or (exp - utcnow()).total_seconds() > soon):
        return token
    try:
        if conn.platform == "tiktok":
            refresh = decrypt(conn.refresh_token_enc)
            if not refresh:
                raise PublishError("La autorización de TikTok caducó: vuelve a conectar la cuenta")
            d = TikTokClient().refresh(refresh)
            conn.refresh_token_enc = encrypt(d.get("refresh_token") or refresh)
        else:
            d = InstagramClient().refresh(token or "")
        conn.access_token_enc = encrypt(d["access_token"])
        conn.expires_at = d.get("expires_at")
        conn.status = "active"
        db.commit()
        return d["access_token"]
    except PublishError:
        conn.status = "expired"
        db.commit()
        raise


def run_publication(pub_id: uuid.UUID) -> None:
    ctx = JobContext("publication", pub_id)
    if not ctx.start():
        return
    try:
        with SessionLocal() as db:
            pub = db.get(Publication, pub_id)
            clip = db.get(Clip, pub.clip_id)
            version = db.get(ClipVersion, pub.clip_version_id)
            media = db.get(MediaAsset, version.render_asset_id) if version and version.render_asset_id else None
            if media is None:
                raise PublishError("La versión del clip no tiene un MP4 renderizado")
            conn = db.get(ChannelConnection, pub.connection_id) if pub.connection_id else None
            if conn is None:
                raise PublishError(f"No hay ninguna cuenta de {PLATFORM_LABELS[pub.platform]} conectada")
            token = _token(db, conn)
            tags = [t.name for t in clip.tags]
            prog = lambda p, stage: ctx.progress(p, stage)  # noqa: E731
            with get_storage().as_local(media.storage_key) as path:
                if pub.platform == "youtube":
                    res = youtube_upload(token, path, pub.title, pub.description or "", pub.privacy, tags, prog)
                elif pub.platform == "tiktok":
                    caption = " ".join(x for x in [pub.title, pub.description] if x)
                    res = TikTokClient().publish(token, path, caption, pub.privacy, prog)
                else:
                    caption = "\n\n".join(x for x in [pub.title, pub.description] if x)
                    res = InstagramClient().publish(token, conn.external_user_id or "", path, caption, prog)
            pub.external_id, pub.external_url, pub.response = res.external_id, res.url, res.details
            pub.privacy = res.privacy
            clip.status = "published"
            platforms = set((clip.platform_data or {}).get("published", []))
            platforms.add(pub.platform)
            clip.platform_data = {**(clip.platform_data or {}), "published": sorted(platforms)}
            db.commit()
            publish(clip.workspace_id, "clip", {"id": str(clip.id), "status": clip.status, "title": clip.title})
        ctx.finish("succeeded")
        ctx.log("info", f"Clip publicado en {PLATFORM_LABELS.get(pub.platform)}", url=res.url)
    except PublishError as exc:
        ctx.log("error", f"Publicación fallida: {exc}")
        ctx.finish("failed", str(exc))
    except Exception as exc:  # errores de red inesperados
        log.exception("Publicación fallida")
        ctx.log("error", f"Publicación fallida: {exc}")
        ctx.finish("failed", str(exc))
