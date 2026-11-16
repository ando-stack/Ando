"""Canales: alta, estado en directo, capacidades reales y autorizaciones."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decrypt, encrypt
from app.db.models import Channel, ChannelConnection, StreamSession, utcnow
from app.integrations.twitch import DOWNLOAD_SCOPES, TwitchError, get_twitch
from app.integrations.urls import ParsedChannel
from app.integrations.youtube import YouTubeError, get_youtube

from .bus import publish
from .jobs import record_event

log = logging.getLogger(__name__)


def _dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def resolve_channel_data(parsed: ParsedChannel) -> dict[str, Any]:
    """Datos del canal desde la API oficial. Sin credenciales devuelve lo deducible del enlace."""
    if parsed.platform == "twitch":
        tw = get_twitch()
        if tw.configured:
            users = tw.get_users(logins=[parsed.value])
            if not users:
                raise LookupError("Ese canal de Twitch no existe")
            u = users[0]
            return {"external_id": u["login"], "platform_user_id": u["id"], "handle": u["login"],
                    "display_name": u["display_name"], "avatar_url": u.get("profile_image_url"),
                    "url": f"https://www.twitch.tv/{u['login']}", "verified": True}
        return {"external_id": parsed.value, "platform_user_id": None, "handle": parsed.value,
                "display_name": parsed.value, "avatar_url": None, "url": parsed.canonical_url, "verified": False}
    yt = get_youtube()
    if yt.configured:
        ch = yt.resolve_channel(parsed.kind, parsed.value)
        if not ch:
            raise LookupError("Ese canal de YouTube no existe")
        sn = ch.get("snippet", {})
        thumbs = sn.get("thumbnails", {})
        handle = (sn.get("customUrl") or "").lstrip("@") or None
        return {"external_id": ch["id"], "platform_user_id": ch["id"], "handle": handle,
                "display_name": sn.get("title", ch["id"]),
                "avatar_url": (thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
                "url": f"https://www.youtube.com/channel/{ch['id']}", "verified": True,
                "live_video_id": parsed.value if parsed.kind == "video" else None, "_raw": ch}
    if parsed.kind == "video":
        return {"external_id": f"video:{parsed.value}", "platform_user_id": None, "handle": None,
                "display_name": f"Vídeo {parsed.value}", "avatar_url": None, "url": parsed.canonical_url,
                "verified": False, "live_video_id": parsed.value}
    return {"external_id": f"{parsed.kind}:{parsed.value}", "platform_user_id": None,
            "handle": parsed.value if parsed.kind == "handle" else None, "display_name": parsed.value,
            "avatar_url": None, "url": parsed.canonical_url, "verified": False}


def user_connection(db: Session, workspace_id: uuid.UUID, platform: str) -> ChannelConnection | None:
    return db.scalar(select(ChannelConnection).where(
        ChannelConnection.workspace_id == workspace_id, ChannelConnection.platform == platform,
        ChannelConnection.kind == "oauth_user", ChannelConnection.status == "active")
        .order_by(ChannelConnection.created_at.desc()))


def source_connection(db: Session, channel: Channel) -> ChannelConnection | None:
    return db.scalar(select(ChannelConnection).where(
        ChannelConnection.channel_id == channel.id, ChannelConnection.kind == "authorized_source",
        ChannelConnection.status.in_(("active", "error"))))


def valid_user_token(db: Session, conn: ChannelConnection) -> str | None:
    """Devuelve un access token válido, renovándolo si ha caducado (y guardándolo cifrado)."""
    token = decrypt(conn.access_token_enc)
    if not token:
        conn.status = "error"
        conn.last_error = "No se pudo descifrar el token"
        db.commit()
        return None
    exp = conn.expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp is None or (exp - utcnow()).total_seconds() > 120:
        return token
    refresh = decrypt(conn.refresh_token_enc)
    if not refresh:
        conn.status = "expired"
        db.commit()
        return None
    try:
        if conn.platform == "twitch":
            ts = get_twitch().refresh(refresh)
            conn.access_token_enc = encrypt(ts.access_token)
            conn.refresh_token_enc = encrypt(ts.refresh_token or refresh)
            conn.expires_at = ts.expires_at
            if ts.scopes:
                conn.scopes = ts.scopes
        else:
            d = get_youtube().refresh(refresh)
            conn.access_token_enc = encrypt(d["access_token"])
            conn.expires_at = d["expires_at"]
        conn.status = "active"
        conn.last_error = None
        db.commit()
        return decrypt(conn.access_token_enc)
    except (TwitchError, YouTubeError) as exc:
        conn.status = "expired"
        conn.last_error = str(exc)
        db.commit()
        return None


# ---------------------------------------------------------------------------
# Capacidades
# ---------------------------------------------------------------------------

def feature(key: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"key": key, "label": label, "status": status, "detail": detail}


def compute_capabilities(db: Session, ch: Channel) -> dict[str, Any]:
    feats: list[dict[str, str]] = []
    src = source_connection(db, ch)
    has_source = src is not None and src.rights_confirmed_at is not None
    feats.append(feature("player", "Reproductor oficial", "available",
                         "Se muestra con el reproductor embebido oficial de la plataforma."))
    if ch.platform == "twitch":
        tw = get_twitch()
        conn = user_connection(db, ch.workspace_id, "twitch")
        scopes = set(conn.scopes or []) if conn else set()
        feats.append(feature("live_status", "Estado y metadatos del directo",
                             "available" if tw.configured else "needs_permission",
                             "Helix API (streams/users)." if tw.configured else
                             "Configura STREAMCUT_TWITCH_CLIENT_ID y _SECRET para detectar si está en directo."))
        feats.append(feature("eventsub", "Eventos de inicio/fin (EventSub)",
                             "available" if conn else "needs_permission",
                             "EventSub por WebSocket con tu cuenta conectada." if conn else
                             "Conecta tu cuenta de Twitch; mientras tanto se consulta el estado cada minuto."))
        feats.append(feature("chat", "Señal del chat", "available",
                             "Lectura anónima de solo lectura del chat público (IRC oficial de Twitch)."))
        can_clip = conn is not None and "clips:edit" in scopes
        feats.append(feature("platform_clips", "Crear clips oficiales de Twitch",
                             "available" if can_clip else "needs_permission",
                             "Se crean con la API de clips (el canal debe permitir clips)." if can_clip else
                             "Conecta tu cuenta de Twitch con el permiso clips:edit."))
        can_dl = conn is not None and bool(scopes & DOWNLOAD_SCOPES)
        feats.append(feature("clip_download", "Descargar clips oficiales",
                             "available" if can_dl else "needs_permission",
                             "Solo el propietario o sus editores pueden descargar clips por API." if not can_dl else
                             "Descarga mediante el endpoint oficial de descargas de clips."
                             ))
    else:
        yt = get_youtube()
        feats.append(feature("live_status", "Estado y metadatos del directo",
                             "available" if yt.configured else "needs_permission",
                             "YouTube Data API v3." if yt.configured else
                             "Configura STREAMCUT_YOUTUBE_API_KEY para detectar directos."))
        feats.append(feature("chat", "Señal del chat",
                             "available" if yt.configured else "needs_permission",
                             "Chat en vivo público mediante la API (consume cuota)." if yt.configured else
                             "Requiere la clave de la API de YouTube."))
        feats.append(feature("platform_clips", "Crear clips oficiales de YouTube", "unavailable",
                             "La API de YouTube no permite crear clips."))
        feats.append(feature("clip_download", "Descargar el directo por API", "unavailable",
                             "La API de YouTube no entrega los bytes del directo."))
    feats.append(feature("media_analysis", "Análisis de audio/vídeo y clips propios",
                         "available" if has_source else "needs_permission",
                         "Fuente autorizada configurada: se graba un buffer circular y se analiza en tiempo real."
                         if has_source else
                         "Añade una fuente audiovisual propia o autorizada (RTMP desde tu OBS, SRT o HLS)."))
    if has_source:
        mode = "FULL_ANALYSIS"
    elif any(f["key"] == "platform_clips" and f["status"] == "available" for f in feats):
        mode = "PLATFORM_CLIPS"
    else:
        mode = "VIEW_ONLY"
    issues = [f["detail"] for f in feats if f["status"] == "needs_permission"]
    return {"mode": mode, "features": feats, "permission_issues": issues, "computed_at": utcnow().isoformat()}


def refresh_capabilities(db: Session, ch: Channel) -> dict[str, Any]:
    ch.capabilities = compute_capabilities(db, ch)
    db.commit()
    return ch.capabilities


# ---------------------------------------------------------------------------
# Estado en directo
# ---------------------------------------------------------------------------

def _apply_live(db: Session, ch: Channel, live: bool, *, title=None, category=None, viewers=None, started=None,
                stream_id=None, video_id=None) -> StreamSession | None:
    was = ch.status
    ch.last_checked_at = utcnow()
    ch.last_error = None
    session: StreamSession | None = db.scalar(select(StreamSession).where(
        StreamSession.channel_id == ch.id, StreamSession.status == "live").order_by(StreamSession.started_at.desc()))
    if live:
        ch.status = "online"
        ch.title, ch.category, ch.viewer_count = title, category, viewers
        ch.live_started_at = started
        ch.live_video_id = video_id
        ch.last_live_at = utcnow()
        if session is None or (stream_id and session.platform_stream_id and session.platform_stream_id != stream_id):
            if session is not None:
                session.status, session.ended_at = "ended", utcnow()
            session = StreamSession(workspace_id=ch.workspace_id, channel_id=ch.id, platform_stream_id=stream_id,
                                    title=title, category=category, started_at=started or utcnow(),
                                    capability_mode=(ch.capabilities or {}).get("mode", "VIEW_ONLY"),
                                    peak_viewers=viewers)
            db.add(session)
            db.flush()
            record_event(db, workspace_id=ch.workspace_id, type="stream_online",
                         label=f"{ch.display_name} ha empezado a emitir", channel_id=ch.id,
                         stream_session_id=session.id, data={"title": title, "category": category})
        else:
            session.title, session.category = title, category
            if viewers is not None:
                session.peak_viewers = max(session.peak_viewers or 0, viewers)
    else:
        ch.status = "offline"
        ch.viewer_count = None
        ch.live_started_at = None
        if session is not None:
            session.status, session.ended_at = "ended", utcnow()
            session.monitoring = False
            record_event(db, workspace_id=ch.workspace_id, type="stream_offline",
                         label=f"{ch.display_name} ha terminado la emisión", channel_id=ch.id,
                         stream_session_id=session.id)
    db.commit()
    if was != ch.status:
        publish(ch.workspace_id, "channel", channel_brief(ch))
    return session if live else None


def refresh_status(db: Session, channels: list[Channel]) -> None:
    """Consulta el estado real de varios canales (Twitch en lote, YouTube uno a uno)."""
    tw = [c for c in channels if c.platform == "twitch"]
    yt = [c for c in channels if c.platform == "youtube"]
    if tw:
        client = get_twitch()
        if not client.configured:
            for c in tw:
                c.status, c.last_checked_at = "unknown", utcnow()
            db.commit()
        else:
            try:
                missing = [c for c in tw if not c.platform_user_id]
                if missing:
                    for u in client.get_users(logins=[c.external_id for c in missing]):
                        for c in missing:
                            if c.external_id == u["login"]:
                                c.platform_user_id = u["id"]
                                c.display_name = u["display_name"]
                                c.avatar_url = u.get("profile_image_url")
                streams = {s["user_id"]: s for s in client.get_streams([c.platform_user_id for c in tw
                                                                        if c.platform_user_id])}
                for c in tw:
                    s = streams.get(c.platform_user_id or "")
                    if s and s.get("type") == "live":
                        _apply_live(db, c, True, title=s.get("title"), category=s.get("game_name"),
                                    viewers=s.get("viewer_count"), started=_dt(s.get("started_at")),
                                    stream_id=s.get("id"))
                    else:
                        _apply_live(db, c, False)
            except TwitchError as exc:
                for c in tw:
                    c.status, c.last_error, c.last_checked_at = "error", str(exc), utcnow()
                db.commit()
    for c in yt:
        client = get_youtube()
        if not client.configured or c.external_id.startswith(("video:", "handle:", "username:")):
            if client.configured and c.live_video_id:
                pass
            else:
                c.status, c.last_checked_at = "unknown", utcnow()
                db.commit()
                continue
        try:
            if c.external_id.startswith("video:") or (c.live_video_id and not c.external_id.startswith("UC")):
                v = client.video(c.live_video_id or c.external_id.split(":", 1)[1])
                live = v if v and v["snippet"].get("liveBroadcastContent") == "live" else None
            else:
                live = client.live_status(c.external_id)
            if live:
                lsd = live.get("liveStreamingDetails", {})
                viewers = lsd.get("concurrentViewers")
                _apply_live(db, c, True, title=live["snippet"].get("title"), category=None,
                            viewers=int(viewers) if viewers else None, started=_dt(lsd.get("actualStartTime")),
                            stream_id=live["id"], video_id=live["id"])
                c.platform_user_id = c.platform_user_id or live["snippet"].get("channelId")
                db.commit()
            else:
                _apply_live(db, c, False)
        except YouTubeError as exc:
            c.status, c.last_error, c.last_checked_at = "error", str(exc), utcnow()
            db.commit()


def channel_brief(c: Channel) -> dict[str, Any]:
    return {"id": str(c.id), "platform": c.platform, "display_name": c.display_name, "status": c.status,
            "title": c.title, "category": c.category, "viewer_count": c.viewer_count,
            "live_started_at": c.live_started_at, "live_video_id": c.live_video_id}
