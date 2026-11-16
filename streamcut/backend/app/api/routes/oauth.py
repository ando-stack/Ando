"""OAuth de Twitch y Google/YouTube. Los tokens se guardan cifrados (Fernet) y nunca se devuelven."""

from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, audit, current_principal
from app.core.config import get_settings
from app.core.security import decrypt, encrypt, read_state, sign_state
from app.db.models import Channel, ChannelConnection
from app.db.session import get_db
from app.integrations.twitch import DEFAULT_SCOPES, TwitchError, get_twitch
from app.integrations.youtube import YouTubeError, get_youtube
from app.services.channels import refresh_capabilities

router = APIRouter(prefix="/oauth", tags=["oauth"])


def _redirect_uri(platform: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/api/oauth/{platform}/callback"


def conn_out(c: ChannelConnection) -> dict:
    return {"id": str(c.id), "platform": c.platform, "kind": c.kind, "status": c.status,
            "login": c.external_login, "user_id": c.external_user_id, "scopes": c.scopes,
            "expires_at": c.expires_at, "last_error": c.last_error, "created_at": c.created_at}


@router.get("/connections")
def connections(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(ChannelConnection).where(ChannelConnection.workspace_id == p.workspace_id,
                                                      ChannelConnection.kind == "oauth_user")
                      .order_by(ChannelConnection.created_at.desc()))
    return [conn_out(c) for c in rows]


@router.get("/{platform}/start")
def start(platform: str, download_scopes: bool = False, p: Principal = Depends(current_principal)):
    state = sign_state({"u": str(p.user.id), "w": str(p.workspace_id), "p": platform, "n": secrets.token_hex(8)})
    try:
        if platform == "twitch":
            scopes = list(DEFAULT_SCOPES) + (["editor:manage:clips"] if download_scopes else [])
            return {"url": get_twitch().authorize_url(_redirect_uri("twitch"), state, scopes)}
        if platform == "youtube":
            return {"url": get_youtube().authorize_url(_redirect_uri("youtube"), state)}
    except (TwitchError, YouTubeError) as exc:
        raise HTTPException(409, str(exc)) from exc
    raise HTTPException(404, "Plataforma no compatible")


def _refresh_caps(db: Session, workspace_id: uuid.UUID, platform: str) -> None:
    for ch in db.scalars(select(Channel).where(Channel.workspace_id == workspace_id, Channel.platform == platform)):
        refresh_capabilities(db, ch)


@router.get("/{platform}/callback")
def callback(platform: str, request: Request, code: str | None = None, state: str | None = None,
             error: str | None = None, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    front = get_settings().public_base_url.rstrip("/")
    data = read_state(state or "")
    if error or not code or not data or data.get("u") != str(p.user.id) or data.get("p") != platform:
        return RedirectResponse(f"{front}/settings?oauth=error&platform={platform}")
    try:
        if platform == "twitch":
            tw = get_twitch()
            tokens = tw.exchange_code(code, _redirect_uri("twitch"))
            info = tw.validate(tokens.access_token)
            login, uid, scopes = info.get("login"), info.get("user_id"), info.get("scopes", tokens.scopes)
            access, refresh, exp = tokens.access_token, tokens.refresh_token, tokens.expires_at
        elif platform == "youtube":
            yt = get_youtube()
            d = yt.exchange_code(code, _redirect_uri("youtube"))
            me = yt.my_channel(d["access_token"]) or {}
            login, uid = me.get("snippet", {}).get("title"), me.get("id")
            scopes = (d.get("scope") or "").split()
            access, refresh, exp = d["access_token"], d.get("refresh_token"), d["expires_at"]
        else:
            raise HTTPException(404, "Plataforma no compatible")
    except (TwitchError, YouTubeError) as exc:
        audit(db, p, "oauth.failed", platform, None, request, error=str(exc))
        return RedirectResponse(f"{front}/settings?oauth=error&platform={platform}")
    conn = db.scalar(select(ChannelConnection).where(ChannelConnection.workspace_id == p.workspace_id,
                                                     ChannelConnection.platform == platform,
                                                     ChannelConnection.kind == "oauth_user",
                                                     ChannelConnection.external_user_id == uid))
    if conn is None:
        conn = ChannelConnection(workspace_id=p.workspace_id, platform=platform, kind="oauth_user")
        db.add(conn)
    conn.external_user_id, conn.external_login, conn.scopes = uid, login, list(scopes or [])
    conn.access_token_enc = encrypt(access)
    if refresh:
        conn.refresh_token_enc = encrypt(refresh)
    conn.expires_at, conn.status, conn.last_error = exp, "active", None
    db.commit()
    _refresh_caps(db, p.workspace_id, platform)
    audit(db, p, "oauth.connected", platform, conn.id, request, scopes=conn.scopes)
    return RedirectResponse(f"{front}/settings?oauth=ok&platform={platform}")


@router.delete("/connections/{connection_id}")
def disconnect(connection_id: uuid.UUID, request: Request, p: Principal = Depends(current_principal),
               db: Session = Depends(get_db)):
    conn = db.scalar(select(ChannelConnection).where(ChannelConnection.id == connection_id,
                                                     ChannelConnection.workspace_id == p.workspace_id,
                                                     ChannelConnection.kind == "oauth_user"))
    if conn is None:
        raise HTTPException(404, "Conexión no encontrada")
    if conn.platform == "twitch":
        token = decrypt(conn.access_token_enc)
        if token:
            try:
                get_twitch().revoke(token)
            except Exception:
                pass
    platform = conn.platform
    db.delete(conn)
    db.commit()
    _refresh_caps(db, p.workspace_id, platform)
    audit(db, p, "oauth.disconnected", platform, connection_id, request)
    return {"ok": True}
