"""Adaptador de YouTube (Data API v3 + OAuth de Google opcional).

La API de YouTube NO entrega los bytes de un directo: se usa solo para identificar canales,
detectar emisiones, leer metadatos y (si es público) el chat en vivo. La visualización se hace con
el reproductor embebido oficial. El análisis audiovisual requiere una fuente propia o autorizada.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)
API = "https://www.googleapis.com/youtube/v3"
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"]


class YouTubeError(Exception):
    def __init__(self, message: str, status: int | None = None, reason: str | None = None):
        super().__init__(message)
        self.status = status
        self.reason = reason


class YouTubeNotConfigured(YouTubeError):
    pass


class YouTubeClient:
    def __init__(self, api_key: str | None = None, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.api_key = api_key if api_key is not None else s.youtube_api_key
        self.client_id = s.google_client_id
        self.client_secret = s.google_client_secret
        self.http = httpx.Client(timeout=15.0, transport=transport)

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @property
    def oauth_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def _get(self, path: str, params: dict[str, Any], token: str | None = None) -> dict:
        if not token and not self.api_key:
            raise YouTubeNotConfigured("YouTube no está configurado (STREAMCUT_YOUTUBE_API_KEY)")
        p = dict(params)
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            p["key"] = self.api_key
        r = self.http.get(f"{API}/{path}", params=p, headers=headers)
        if r.status_code >= 400:
            reason = None
            try:
                err = r.json().get("error", {})
                reason = (err.get("errors") or [{}])[0].get("reason")
                msg = err.get("message", r.text)
            except Exception:
                msg = r.text
            if reason == "quotaExceeded":
                msg = "Se agotó la cuota diaria de la API de YouTube"
            raise YouTubeError(f"YouTube respondió {r.status_code}: {msg}", r.status_code, reason)
        return r.json()

    # -- canales ----------------------------------------------------------------
    def resolve_channel(self, kind: str, value: str) -> dict | None:
        parts = "snippet,contentDetails,statistics"
        if kind == "channel_id":
            items = self._get("channels", {"part": parts, "id": value}).get("items", [])
        elif kind == "handle":
            items = self._get("channels", {"part": parts, "forHandle": "@" + value.lstrip("@")}).get("items", [])
        elif kind == "username":
            items = self._get("channels", {"part": parts, "forUsername": value}).get("items", [])
        elif kind == "video":
            vids = self._get("videos", {"part": "snippet", "id": value}).get("items", [])
            if not vids:
                return None
            items = self._get("channels", {"part": parts, "id": vids[0]["snippet"]["channelId"]}).get("items", [])
        else:
            return None
        return items[0] if items else None

    def live_status(self, channel: dict | str, use_search: bool = False) -> dict | None:
        """Devuelve el vídeo en directo del canal (o None).

        Por defecto usa la lista de subidas (2 unidades de cuota) en vez de search.list (100 unidades).
        """
        if isinstance(channel, str):
            channel = self.resolve_channel("channel_id", channel) or {}
        uploads = channel.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        ids: list[str] = []
        if uploads:
            try:
                items = self._get("playlistItems", {"part": "contentDetails", "playlistId": uploads,
                                                    "maxResults": 10}).get("items", [])
                ids = [i["contentDetails"]["videoId"] for i in items]
            except YouTubeError as exc:
                if exc.status != 404:
                    raise
        if use_search or not ids:
            res = self._get("search", {"part": "id", "channelId": channel.get("id"), "eventType": "live",
                                       "type": "video", "maxResults": 1}).get("items", [])
            ids = [r["id"]["videoId"] for r in res] + ids
        if not ids:
            return None
        vids = self._get("videos", {"part": "snippet,liveStreamingDetails,statistics",
                                    "id": ",".join(ids[:50])}).get("items", [])
        for v in vids:
            if v.get("snippet", {}).get("liveBroadcastContent") == "live":
                return v
        return None

    def video(self, video_id: str) -> dict | None:
        items = self._get("videos", {"part": "snippet,liveStreamingDetails,statistics,contentDetails",
                                     "id": video_id}).get("items", [])
        return items[0] if items else None

    def live_chat_messages(self, live_chat_id: str, page_token: str | None = None) -> dict:
        params = {"liveChatId": live_chat_id, "part": "snippet,authorDetails", "maxResults": 2000}
        if page_token:
            params["pageToken"] = page_token
        return self._get("liveChat/messages", params)

    # -- OAuth Google -------------------------------------------------------------
    def authorize_url(self, redirect_uri: str, state: str) -> str:
        if not self.oauth_configured:
            raise YouTubeNotConfigured("OAuth de Google no configurado (STREAMCUT_GOOGLE_CLIENT_ID/SECRET)")
        q = {"client_id": self.client_id, "redirect_uri": redirect_uri, "response_type": "code",
             "scope": " ".join(SCOPES), "state": state, "access_type": "offline", "prompt": "consent",
             "include_granted_scopes": "true"}
        return f"{GOOGLE_AUTH}?{urlencode(q)}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        r = self.http.post(GOOGLE_TOKEN, data={"client_id": self.client_id, "client_secret": self.client_secret,
                                               "code": code, "grant_type": "authorization_code",
                                               "redirect_uri": redirect_uri})
        if r.status_code != 200:
            raise YouTubeError(f"Intercambio OAuth fallido: {r.status_code}", r.status_code)
        d = r.json()
        d["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=int(d.get("expires_in", 3600)))
        return d

    def refresh(self, refresh_token: str) -> dict:
        r = self.http.post(GOOGLE_TOKEN, data={"client_id": self.client_id, "client_secret": self.client_secret,
                                               "grant_type": "refresh_token", "refresh_token": refresh_token})
        if r.status_code != 200:
            raise YouTubeError("La autorización de Google ha caducado o fue revocada", r.status_code)
        d = r.json()
        d["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=int(d.get("expires_in", 3600)))
        return d

    def my_channel(self, token: str) -> dict | None:
        items = self._get("channels", {"part": "snippet", "mine": "true"}, token=token).get("items", [])
        return items[0] if items else None


_client: YouTubeClient | None = None


def get_youtube() -> YouTubeClient:
    global _client
    if _client is None:
        _client = YouTubeClient()
    return _client


def set_youtube(client: YouTubeClient | None) -> None:
    global _client
    _client = client
