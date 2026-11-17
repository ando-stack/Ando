"""Publicación de clips en YouTube (Shorts), TikTok e Instagram (Reels) con las APIs oficiales.

Cada plataforma exige una aplicación de desarrollador propia (credenciales en .env) y que el usuario
autorice su cuenta. Limitaciones oficiales importantes:
- YouTube: los proyectos de Google sin verificar suben los vídeos como PRIVADOS hasta superar la
  auditoría de la API de YouTube.
- TikTok: las apps sin auditar solo pueden publicar en modo privado (SELF_ONLY).
- Instagram: necesita una cuenta profesional (Creador o Empresa); en modo desarrollo solo publica en
  cuentas con rol en la app.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

Progress = Callable[[float, str], None]


class PublishError(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class PublishResult:
    external_id: str
    url: str | None
    privacy: str
    details: dict[str, Any] = field(default_factory=dict)


def _expires(seconds: Any) -> datetime | None:
    try:
        return datetime.now(timezone.utc) + timedelta(seconds=int(seconds))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# YouTube (Shorts)
# ---------------------------------------------------------------------------

YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos"


def youtube_upload(token: str, path: Path, title: str, description: str, privacy: str, tags: list[str],
                   progress: Progress, transport: httpx.BaseTransport | None = None) -> PublishResult:
    """Subida reanudable. Un vídeo vertical de hasta 3 minutos se publica como Short."""
    if "#shorts" not in (title + description).lower():
        description = (description + "\n\n#Shorts").strip()
    size = path.stat().st_size
    meta = {"snippet": {"title": title[:100], "description": description[:4900], "tags": tags[:30],
                        "categoryId": "20"},
            "status": {"privacyStatus": privacy if privacy in ("public", "unlisted", "private") else "public",
                       "selfDeclaredMadeForKids": False}}
    with httpx.Client(timeout=60, transport=transport) as c:
        r = c.post(YT_UPLOAD, params={"uploadType": "resumable", "part": "snippet,status"}, json=meta,
                   headers={"Authorization": f"Bearer {token}", "X-Upload-Content-Length": str(size),
                            "X-Upload-Content-Type": "video/mp4"})
        if r.status_code == 401:
            raise PublishError("La autorización de YouTube caducó: vuelve a conectar la cuenta")
        if r.status_code == 403:
            raise PublishError(f"YouTube rechazó la subida: {_err(r)} (¿cuota agotada o falta el permiso de subida?)")
        if r.status_code >= 400 or "location" not in r.headers:
            raise PublishError(f"YouTube no aceptó la subida: {_err(r)}", retryable=r.status_code >= 500)
        upload_url = r.headers["location"]
        progress(0.1, "Subiendo a YouTube")
        chunk = 8 * 1024 * 1024
        with open(path, "rb") as f:
            sent = 0
            while True:
                data = f.read(chunk)
                end = sent + len(data) - 1
                rr = c.put(upload_url, content=data, headers={"Content-Type": "video/mp4",
                                                              "Content-Range": f"bytes {sent}-{end}/{size}"})
                sent += len(data)
                progress(0.1 + 0.85 * sent / size, "Subiendo a YouTube")
                if rr.status_code in (200, 201):
                    body = rr.json()
                    vid = body["id"]
                    status = body.get("status", {}).get("privacyStatus", privacy)
                    return PublishResult(vid, f"https://www.youtube.com/shorts/{vid}", status,
                                         {"upload_status": body.get("status", {}).get("uploadStatus")})
                if rr.status_code != 308:
                    raise PublishError(f"Error subiendo a YouTube: {_err(rr)}", retryable=rr.status_code >= 500)
                if sent >= size:
                    raise PublishError("YouTube no confirmó la subida")


# ---------------------------------------------------------------------------
# TikTok (Content Posting API)
# ---------------------------------------------------------------------------

TT_AUTH = "https://www.tiktok.com/v2/auth/authorize/"
TT_API = "https://open.tiktokapis.com/v2"
TT_SCOPES = "user.info.basic,video.publish,video.upload"


class TikTokClient:
    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.key, self.secret = s.tiktok_client_key, s.tiktok_client_secret
        self.http = httpx.Client(timeout=60, transport=transport)

    @property
    def configured(self) -> bool:
        return bool(self.key and self.secret)

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        if not self.configured:
            raise PublishError("TikTok no está configurado (STREAMCUT_TIKTOK_CLIENT_KEY / _SECRET)")
        return f"{TT_AUTH}?" + urlencode({"client_key": self.key, "scope": TT_SCOPES, "response_type": "code",
                                         "redirect_uri": redirect_uri, "state": state})

    def _token(self, data: dict) -> dict:
        r = self.http.post(f"{TT_API}/oauth/token/", data={"client_key": self.key, "client_secret": self.secret,
                                                            **data},
                           headers={"Content-Type": "application/x-www-form-urlencoded"})
        body = r.json() if r.content else {}
        if r.status_code >= 400 or "access_token" not in body:
            raise PublishError(f"TikTok rechazó la autorización: {body.get('error_description') or body.get('error') or r.status_code}")
        body["expires_at"] = _expires(body.get("expires_in"))
        return body

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        return self._token({"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri})

    def refresh(self, refresh_token: str) -> dict:
        return self._token({"grant_type": "refresh_token", "refresh_token": refresh_token})

    def _post(self, token: str, path: str, payload: dict) -> dict:
        r = self.http.post(f"{TT_API}{path}", json=payload,
                           headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"})
        body = r.json() if r.content else {}
        err = body.get("error", {})
        if r.status_code >= 400 or (err and err.get("code") not in (None, "ok")):
            code = err.get("code", r.status_code)
            msg = err.get("message", "")
            if code == "unaudited_client_can_only_post_to_private_accounts":
                msg = ("tu app de TikTok aún no está auditada: solo puede publicar en privado. Pon tu cuenta "
                       "de TikTok en privado o solicita la auditoría en developers.tiktok.com")
            elif code == "spam_risk_too_many_posts":
                msg = "TikTok limita el número de publicaciones diarias; inténtalo más tarde"
            raise PublishError(f"TikTok: {msg or code}", retryable=r.status_code >= 500)
        return body.get("data", {})

    def user(self, token: str) -> dict:
        r = self.http.get(f"{TT_API}/user/info/", params={"fields": "open_id,display_name,username"},
                          headers={"Authorization": f"Bearer {token}"})
        return (r.json().get("data", {}) or {}).get("user", {}) if r.status_code == 200 else {}

    def publish(self, token: str, path: Path, title: str, privacy: str, progress: Progress) -> PublishResult:
        info = self._post(token, "/post/publish/creator_info/query/", {})
        options = info.get("privacy_level_options") or ["SELF_ONLY"]
        wanted = {"public": "PUBLIC_TO_EVERYONE", "friends": "MUTUAL_FOLLOW_FRIENDS",
                  "private": "SELF_ONLY"}.get(privacy, "PUBLIC_TO_EVERYONE")
        level = wanted if wanted in options else ("SELF_ONLY" if "SELF_ONLY" in options else options[0])
        size = path.stat().st_size
        # Archivos de hasta 64 MB en un único trozo; si no, trozos de 10 MB (el último absorbe el resto)
        chunk = size if size <= 64 * 1024 * 1024 else 10 * 1024 * 1024
        total = max(1, size // chunk)
        init = self._post(token, "/post/publish/video/init/", {
            "post_info": {"title": title[:2200], "privacy_level": level, "disable_duet": False,
                          "disable_comment": False, "disable_stitch": False, "video_cover_timestamp_ms": 1000},
            "source_info": {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk,
                            "total_chunk_count": total}})
        publish_id, upload_url = init["publish_id"], init["upload_url"]
        progress(0.1, "Subiendo a TikTok")
        with open(path, "rb") as f:
            for i in range(total):
                start = i * chunk
                length = size - start if i == total - 1 else chunk
                data = f.read(length)
                r = self.http.put(upload_url, content=data, headers={
                    "Content-Type": "video/mp4", "Content-Range": f"bytes {start}-{start + length - 1}/{size}"})
                if r.status_code not in (200, 201, 206):
                    raise PublishError(f"Error subiendo a TikTok ({r.status_code})", retryable=r.status_code >= 500)
                progress(0.1 + 0.6 * (i + 1) / total, "Subiendo a TikTok")
        for _ in range(60):  # TikTok procesa el vídeo de forma asíncrona
            time.sleep(5)
            st = self._post(token, "/post/publish/status/fetch/", {"publish_id": publish_id})
            status = st.get("status")
            progress(0.8, "TikTok está procesando el vídeo")
            if status == "PUBLISH_COMPLETE":
                ids = st.get("publicaly_available_post_id") or []
                url = f"https://www.tiktok.com/video/{ids[0]}" if ids else None
                return PublishResult(str(ids[0]) if ids else publish_id, url, level, {"publish_id": publish_id})
            if status == "FAILED":
                raise PublishError(f"TikTok no pudo publicar el vídeo: {st.get('fail_reason', 'motivo desconocido')}")
        return PublishResult(publish_id, None, level, {"publish_id": publish_id, "note": "TikTok sigue procesando"})


# ---------------------------------------------------------------------------
# Instagram (Reels, API de Instagram con inicio de sesión de Instagram)
# ---------------------------------------------------------------------------

IG_AUTH = "https://www.instagram.com/oauth/authorize"
IG_GRAPH = "https://graph.instagram.com"
IG_VERSION = "v21.0"
IG_SCOPES = "instagram_business_basic,instagram_business_content_publish"


class InstagramClient:
    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.app_id, self.secret = s.instagram_app_id, s.instagram_app_secret
        self.http = httpx.Client(timeout=120, transport=transport)

    @property
    def configured(self) -> bool:
        return bool(self.app_id and self.secret)

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        if not self.configured:
            raise PublishError("Instagram no está configurado (STREAMCUT_INSTAGRAM_APP_ID / _SECRET)")
        return f"{IG_AUTH}?" + urlencode({"client_id": self.app_id, "redirect_uri": redirect_uri,
                                         "response_type": "code", "scope": IG_SCOPES, "state": state})

    def _get(self, path: str, params: dict) -> dict:
        r = self.http.get(f"{IG_GRAPH}/{path}", params=params)
        body = r.json() if r.content else {}
        if r.status_code >= 400 or "error" in body:
            e = body.get("error", {})
            raise PublishError(f"Instagram: {e.get('error_user_msg') or e.get('message') or r.status_code}",
                               retryable=r.status_code >= 500)
        return body

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        r = self.http.post("https://api.instagram.com/oauth/access_token", data={
            "client_id": self.app_id, "client_secret": self.secret, "grant_type": "authorization_code",
            "redirect_uri": redirect_uri, "code": code})
        body = r.json() if r.content else {}
        body = (body.get("data") or [body])[0] if isinstance(body.get("data"), list) else body
        if "access_token" not in body:
            raise PublishError(f"Instagram rechazó la autorización: {body.get('error_message') or r.status_code}")
        return self.long_lived(body["access_token"])

    def long_lived(self, short_token: str) -> dict:
        body = self._get("access_token", {"grant_type": "ig_exchange_token", "client_secret": self.secret,
                                          "access_token": short_token})
        body["expires_at"] = _expires(body.get("expires_in"))
        return body

    def refresh(self, token: str) -> dict:
        body = self._get("refresh_access_token", {"grant_type": "ig_refresh_token", "access_token": token})
        body["expires_at"] = _expires(body.get("expires_in"))
        return body

    def me(self, token: str) -> dict:
        return self._get(f"{IG_VERSION}/me", {"fields": "user_id,username,account_type", "access_token": token})

    def publish(self, token: str, ig_user_id: str, path: Path, caption: str, progress: Progress) -> PublishResult:
        size = path.stat().st_size
        r = self.http.post(f"{IG_GRAPH}/{IG_VERSION}/{ig_user_id}/media", params={
            "media_type": "REELS", "upload_type": "resumable", "caption": caption[:2200], "share_to_feed": "true",
            "access_token": token})
        body = r.json() if r.content else {}
        if r.status_code >= 400 or "id" not in body:
            e = body.get("error", {})
            raise PublishError(f"Instagram no aceptó el Reel: {e.get('error_user_msg') or e.get('message') or r.status_code}")
        container = body["id"]
        progress(0.1, "Subiendo a Instagram")
        with open(path, "rb") as f:
            up = self.http.post(f"https://rupload.facebook.com/ig-api-upload/{IG_VERSION}/{container}",
                                content=f.read(), headers={"Authorization": f"OAuth {token}", "offset": "0",
                                                           "file_size": str(size)})
        if up.status_code >= 400:
            raise PublishError(f"Error subiendo a Instagram ({up.status_code})", retryable=up.status_code >= 500)
        progress(0.6, "Instagram está procesando el vídeo")
        for _ in range(60):
            time.sleep(5)
            st = self._get(f"{IG_VERSION}/{container}", {"fields": "status_code,status", "access_token": token})
            code = st.get("status_code")
            if code == "FINISHED":
                break
            if code in ("ERROR", "EXPIRED"):
                raise PublishError(f"Instagram no pudo procesar el vídeo: {st.get('status', code)}")
        else:
            raise PublishError("Instagram tardó demasiado en procesar el vídeo", retryable=True)
        pub = self.http.post(f"{IG_GRAPH}/{IG_VERSION}/{ig_user_id}/media_publish",
                             params={"creation_id": container, "access_token": token})
        pbody = pub.json() if pub.content else {}
        if pub.status_code >= 400 or "id" not in pbody:
            e = pbody.get("error", {})
            raise PublishError(f"Instagram no publicó el Reel: {e.get('error_user_msg') or e.get('message') or pub.status_code}")
        media_id = pbody["id"]
        try:
            link = self._get(f"{IG_VERSION}/{media_id}", {"fields": "permalink", "access_token": token}).get("permalink")
        except PublishError:
            link = None
        return PublishResult(media_id, link, "public", {"container_id": container})


def _err(r: httpx.Response) -> str:
    try:
        e = r.json().get("error", {})
        return e.get("message") or str(r.status_code)
    except Exception:
        return str(r.status_code)
