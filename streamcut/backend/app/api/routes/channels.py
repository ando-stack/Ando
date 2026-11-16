from __future__ import annotations

import secrets
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, audit, current_principal
from app.core.config import get_settings
from app.core.netsafe import UnsafeURL, validate_source_url
from app.core.security import decrypt, encrypt
from app.db.models import Channel, ChannelConnection, Clip, StreamSession, Template, utcnow
from app.db.session import get_db
from app.integrations.twitch import TwitchError
from app.integrations.urls import InvalidChannelURL, parse_channel
from app.integrations.youtube import YouTubeError
from app.services.channels import (
    channel_brief,
    compute_capabilities,
    refresh_capabilities,
    refresh_status,
    resolve_channel_data,
    source_connection,
)

router = APIRouter(prefix="/channels", tags=["channels"])


class ResolveIn(BaseModel):
    url: str = Field(max_length=500)
    platform: Literal["twitch", "youtube"] | None = None


class ChannelUpdate(BaseModel):
    is_tracked: bool | None = None
    priority: int | None = Field(None, ge=1, le=10)
    default_template_id: uuid.UUID | None = None
    autopilot: dict[str, Any] | None = None


class SourceIn(BaseModel):
    mode: Literal["pull", "listen"]
    url: str | None = Field(None, max_length=2048)
    rights_confirmed: bool = False


def channel_out(db: Session, c: Channel, with_caps: bool = True) -> dict[str, Any]:
    src = source_connection(db, c)
    d = {
        **channel_brief(c),
        "external_id": c.external_id, "platform_user_id": c.platform_user_id, "handle": c.handle,
        "url": c.url, "avatar_url": c.avatar_url, "is_tracked": c.is_tracked, "priority": c.priority,
        "last_live_at": c.last_live_at, "last_checked_at": c.last_checked_at, "last_error": c.last_error,
        "created_at": c.created_at, "default_template_id": str(c.default_template_id) if c.default_template_id else None,
        "autopilot": c.autopilot or {},
        "capabilities": c.capabilities if with_caps else None,
        "source": None if src is None else {
            "id": str(src.id), "mode": src.source_mode, "status": src.status, "last_error": src.last_error,
            "rights_confirmed": src.rights_confirmed_at is not None, "listen_port": src.listen_port,
            "ingest_url": (f"rtmp://<IP-de-este-equipo>:{src.listen_port}/live" if src.source_mode == "listen" else None),
        },
        "clips_count": db.scalar(select(func.count(Clip.id)).where(Clip.channel_id == c.id, Clip.deleted_at.is_(None))),
    }
    live = db.scalar(select(StreamSession).where(StreamSession.channel_id == c.id, StreamSession.status == "live")
                     .order_by(StreamSession.started_at.desc()))
    d["session"] = session_out(live) if live else None
    return d


def session_out(s: StreamSession) -> dict[str, Any]:
    return {"id": str(s.id), "status": s.status, "monitoring": s.monitoring, "capability_mode": s.capability_mode,
            "started_at": s.started_at, "ended_at": s.ended_at, "title": s.title, "category": s.category,
            "peak_viewers": s.peak_viewers, "analyzed_seconds": s.analyzed_seconds}


def _get(db: Session, p: Principal, channel_id: uuid.UUID) -> Channel:
    c = db.scalar(select(Channel).where(Channel.id == channel_id, Channel.workspace_id == p.workspace_id))
    if c is None:
        raise HTTPException(404, "Canal no encontrado")
    return c


@router.post("/resolve")
def resolve(body: ResolveIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Identifica el canal de un enlace, lo registra (si no existe) y devuelve su estado real."""
    try:
        parsed = parse_channel(body.url, body.platform)
    except InvalidChannelURL as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.platform and parsed.platform != body.platform:
        raise HTTPException(422, f"El enlace es de {parsed.platform}, no de {body.platform}")
    try:
        data = resolve_channel_data(parsed)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (TwitchError, YouTubeError) as exc:
        raise HTTPException(502, str(exc)) from exc
    ch = db.scalar(select(Channel).where(Channel.workspace_id == p.workspace_id, Channel.platform == parsed.platform,
                                         Channel.external_id == data["external_id"]))
    created = ch is None
    if ch is None:
        ch = Channel(workspace_id=p.workspace_id, platform=parsed.platform, external_id=data["external_id"],
                     display_name=data["display_name"], url=data["url"])
        db.add(ch)
    ch.platform_user_id = data.get("platform_user_id") or ch.platform_user_id
    ch.handle = data.get("handle") or ch.handle
    ch.display_name = data["display_name"]
    ch.avatar_url = data.get("avatar_url") or ch.avatar_url
    if data.get("live_video_id"):
        ch.live_video_id = data["live_video_id"]
    db.commit()
    refresh_status(db, [ch])
    refresh_capabilities(db, ch)
    out = channel_out(db, ch)
    out["created"] = created
    out["verified"] = data.get("verified", False)
    return out


@router.get("")
def list_channels(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    chans = list(db.scalars(select(Channel).where(Channel.workspace_id == p.workspace_id)
                            .order_by(Channel.created_at.desc())))
    chans.sort(key=lambda c: (c.status != "online", not c.is_tracked))
    return [channel_out(db, c) for c in chans]


@router.get("/{channel_id}")
def get_channel(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return channel_out(db, _get(db, p, channel_id))


@router.post("/{channel_id}/refresh")
def refresh(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    refresh_status(db, [c])
    refresh_capabilities(db, c)
    return channel_out(db, c)


@router.patch("/{channel_id}")
def update_channel(channel_id: uuid.UUID, body: ChannelUpdate, p: Principal = Depends(current_principal),
                   db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    if body.is_tracked is not None:
        c.is_tracked = body.is_tracked
    if body.priority is not None:
        c.priority = body.priority
    if body.default_template_id is not None:
        t = db.get(Template, body.default_template_id)
        if t is None or (t.workspace_id not in (None, p.workspace_id)):
            raise HTTPException(404, "Plantilla no encontrada")
        c.default_template_id = t.id
    if body.autopilot is not None:
        allowed = {"enabled", "categories", "sensitivity", "min_score", "max_clips_per_stream", "duration_mode",
                   "format", "template_slug", "subtitles", "auto_edit", "auto_save", "create_platform_clips"}
        bad = set(body.autopilot) - allowed
        if bad:
            raise HTTPException(422, f"Opciones desconocidas: {', '.join(sorted(bad))}")
        c.autopilot = {**(c.autopilot or {}), **body.autopilot}
        if body.autopilot.get("enabled"):
            c.is_tracked = True
    db.commit()
    return channel_out(db, c)


@router.delete("/{channel_id}")
def delete_channel(channel_id: uuid.UUID, request: Request, p: Principal = Depends(current_principal),
                   db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    db.delete(c)  # los clips se conservan (channel_id → NULL)
    db.commit()
    audit(db, p, "channel.delete", "channel", channel_id, request)
    return {"ok": True}


@router.get("/{channel_id}/sessions")
def sessions(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    rows = db.scalars(select(StreamSession).where(StreamSession.channel_id == c.id)
                      .order_by(StreamSession.started_at.desc()).limit(100))
    out = []
    for s in rows:
        d = session_out(s)
        d["clips"] = db.scalar(select(func.count(Clip.id)).where(Clip.stream_session_id == s.id))
        out.append(d)
    return out


# -- Fuente audiovisual autorizada ----------------------------------------------------

def _free_port(db: Session) -> int:
    used = {x for x in db.scalars(select(ChannelConnection.listen_port).where(ChannelConnection.listen_port.is_not(None)))}
    port = get_settings().rtmp_base_port
    while port in used:
        port += 1
    return port


@router.put("/{channel_id}/source")
def set_source(channel_id: uuid.UUID, body: SourceIn, request: Request, p: Principal = Depends(current_principal),
               db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    if not body.rights_confirmed:
        raise HTTPException(422, "Debes confirmar que la señal es tuya o que tienes autorización para analizarla")
    conn = source_connection(db, c) or ChannelConnection(workspace_id=p.workspace_id, channel_id=c.id,
                                                         platform=c.platform, kind="authorized_source")
    if body.mode == "pull":
        if not body.url:
            raise HTTPException(422, "Indica la URL de la señal (rtmp://, srt:// o https://…m3u8)")
        try:
            url = validate_source_url(body.url)
        except UnsafeURL as exc:
            raise HTTPException(422, str(exc)) from exc
        conn.source_url_enc = encrypt(url)
        conn.stream_key_enc = None
        conn.listen_port = None
    else:
        conn.source_url_enc = None
        conn.stream_key_enc = encrypt(secrets.token_urlsafe(18))
        conn.listen_port = conn.listen_port or _free_port(db)
    conn.source_mode = body.mode
    conn.status = "active"
    conn.last_error = None
    conn.rights_confirmed_at = utcnow()
    db.add(conn)
    db.commit()
    refresh_capabilities(db, c)
    audit(db, p, "channel.source_set", "channel", c.id, request, mode=body.mode)
    out = channel_out(db, c)
    if body.mode == "listen":
        out["stream_key"] = decrypt(conn.stream_key_enc)  # se muestra una vez para configurar OBS
    return out


@router.get("/{channel_id}/source/key")
def reveal_key(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    conn = source_connection(db, c)
    if conn is None or conn.source_mode != "listen":
        raise HTTPException(404, "El canal no tiene un servidor RTMP local configurado")
    return {"server": f"rtmp://<IP-de-este-equipo>:{conn.listen_port}/live", "stream_key": decrypt(conn.stream_key_enc)}


@router.delete("/{channel_id}/source")
def delete_source(channel_id: uuid.UUID, request: Request, p: Principal = Depends(current_principal),
                  db: Session = Depends(get_db)):
    c = _get(db, p, channel_id)
    conn = source_connection(db, c)
    if conn:
        db.delete(conn)
        db.commit()
    refresh_capabilities(db, c)
    audit(db, p, "channel.source_removed", "channel", c.id, request)
    return channel_out(db, c)


@router.get("/{channel_id}/capabilities")
def capabilities(channel_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return compute_capabilities(db, _get(db, p, channel_id))
