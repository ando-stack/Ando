"""Integración oficial con Twitch (Helix + OAuth).

- App Access Token (client credentials) para consultar usuarios y emisiones.
- User Access Token (authorization code) para crear clips, EventSub por WebSocket, etc.
- Respeta los límites (cabeceras Ratelimit-*) y reintenta 429/5xx con espera.
- Nunca se extrae vídeo del reproductor embebido.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

HELIX = "https://api.twitch.tv/helix"
ID = "https://id.twitch.tv/oauth2"
DEFAULT_SCOPES = ["clips:edit", "user:read:email"]
DOWNLOAD_SCOPES = {"editor:manage:clips", "channel:manage:clips"}


class TwitchError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class TwitchNotConfigured(TwitchError):
    pass


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    scopes: list[str]


class TwitchClient:
    def __init__(self, client_id: str | None = None, client_secret: str | None = None,
                 transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.client_id = client_id if client_id is not None else s.twitch_client_id
        self.client_secret = client_secret if client_secret is not None else s.twitch_client_secret
        self.http = httpx.Client(timeout=15.0, transport=transport)
        self._app_token: str | None = None
        self._app_token_exp = 0.0
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    # -- tokens ---------------------------------------------------------------
    def app_token(self) -> str:
        if not self.configured:
            raise TwitchNotConfigured("Twitch no está configurado (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)")
        with self._lock:
            if self._app_token and time.time() < self._app_token_exp - 60:
                return self._app_token
            r = self.http.post(f"{ID}/token", data={"client_id": self.client_id, "client_secret": self.client_secret,
                                                     "grant_type": "client_credentials"})
            if r.status_code != 200:
                raise TwitchError(f"No se pudo obtener el token de aplicación: {r.status_code}", r.status_code)
            data = r.json()
            self._app_token = data["access_token"]
            self._app_token_exp = time.time() + int(data.get("expires_in", 3600))
            return self._app_token

    def authorize_url(self, redirect_uri: str, state: str, scopes: list[str] | None = None) -> str:
        if not self.configured:
            raise TwitchNotConfigured("Twitch no está configurado")
        q = {"client_id": self.client_id, "redirect_uri": redirect_uri, "response_type": "code",
             "scope": " ".join(scopes or DEFAULT_SCOPES), "state": state, "force_verify": "true"}
        return f"{ID}/authorize?{urlencode(q)}"

    def _tokens(self, data: dict) -> TokenSet:
        exp = datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 0))) \
            if data.get("expires_in") else None
        return TokenSet(data["access_token"], data.get("refresh_token"), exp, list(data.get("scope") or []))

    def exchange_code(self, code: str, redirect_uri: str) -> TokenSet:
        r = self.http.post(f"{ID}/token", data={"client_id": self.client_id, "client_secret": self.client_secret,
                                                 "code": code, "grant_type": "authorization_code",
                                                 "redirect_uri": redirect_uri})
        if r.status_code != 200:
            raise TwitchError(f"Intercambio OAuth fallido: {r.status_code}", r.status_code)
        return self._tokens(r.json())

    def refresh(self, refresh_token: str) -> TokenSet:
        r = self.http.post(f"{ID}/token", data={"client_id": self.client_id, "client_secret": self.client_secret,
                                                 "grant_type": "refresh_token", "refresh_token": refresh_token})
        if r.status_code != 200:
            raise TwitchError("La autorización de Twitch ha caducado o fue revocada", r.status_code)
        return self._tokens(r.json())

    def validate(self, access_token: str) -> dict:
        r = self.http.get(f"{ID}/validate", headers={"Authorization": f"OAuth {access_token}"})
        if r.status_code != 200:
            raise TwitchError("Token no válido", r.status_code)
        return r.json()

    def revoke(self, access_token: str) -> None:
        self.http.post(f"{ID}/revoke", data={"client_id": self.client_id, "token": access_token})

    # -- Helix -----------------------------------------------------------------
    def _request(self, method: str, path: str, *, token: str | None = None, params: Any = None,
                 json: Any = None, retries: int = 3) -> httpx.Response:
        for attempt in range(retries + 1):
            bearer = token or self.app_token()
            r = self.http.request(method, f"{HELIX}{path}", params=params, json=json,
                                  headers={"Client-Id": self.client_id, "Authorization": f"Bearer {bearer}"})
            if r.status_code == 429 and attempt < retries:
                reset = float(r.headers.get("Ratelimit-Reset", time.time() + 1))
                time.sleep(min(10.0, max(0.5, reset - time.time())))
                continue
            if r.status_code >= 500 and attempt < retries:
                time.sleep(0.5 * 2 ** attempt)
                continue
            if r.status_code == 401 and token is None and attempt == 0:
                self._app_token = None
                continue
            remaining = r.headers.get("Ratelimit-Remaining")
            if remaining is not None and int(remaining) < 5:
                log.warning("Twitch: quedan %s peticiones en la ventana de rate limit", remaining)
            return r
        return r

    def _json(self, r: httpx.Response) -> dict:
        if r.status_code >= 400:
            try:
                msg = r.json().get("message", r.text)
            except Exception:
                msg = r.text
            raise TwitchError(f"Twitch respondió {r.status_code}: {msg}", r.status_code)
        return r.json() if r.content else {}

    def get_users(self, logins: list[str] | None = None, ids: list[str] | None = None,
                  token: str | None = None) -> list[dict]:
        params = [("login", x) for x in (logins or [])] + [("id", x) for x in (ids or [])]
        return self._json(self._request("GET", "/users", params=params, token=token)).get("data", [])

    def get_streams(self, user_ids: list[str]) -> list[dict]:
        out: list[dict] = []
        for i in range(0, len(user_ids), 100):
            params = [("user_id", x) for x in user_ids[i:i + 100]] + [("first", "100")]
            out += self._json(self._request("GET", "/streams", params=params)).get("data", [])
        return out

    def get_channel_info(self, broadcaster_id: str) -> dict | None:
        data = self._json(self._request("GET", "/channels", params={"broadcaster_id": broadcaster_id})).get("data", [])
        return data[0] if data else None

    def get_videos(self, user_id: str, first: int = 10) -> list[dict]:
        return self._json(self._request("GET", "/videos", params={"user_id": user_id, "first": first,
                                                                  "type": "archive"})).get("data", [])

    def create_clip(self, user_token: str, broadcaster_id: str, has_delay: bool = True) -> dict:
        # has_delay=true: Twitch compensa el retraso entre la emisión y lo que ven los espectadores,
        # que es a lo que reacciona el chat.
        r = self._request("POST", "/clips", token=user_token,
                          params={"broadcaster_id": broadcaster_id, "has_delay": str(has_delay).lower()})
        if r.status_code == 403:
            raise TwitchError("El canal no permite crear clips o falta el permiso clips:edit", 403)
        if r.status_code == 404:
            raise TwitchError("El canal no está en directo", 404)
        data = self._json(r).get("data", [])
        if not data:
            raise TwitchError("Twitch no devolvió el clip creado")
        return data[0]

    def get_clips(self, ids: list[str] | None = None, broadcaster_id: str | None = None, first: int = 20,
                  token: str | None = None) -> list[dict]:
        params: list[tuple[str, str]] = [("id", x) for x in (ids or [])]
        if broadcaster_id:
            params += [("broadcaster_id", broadcaster_id), ("first", str(first))]
        return self._json(self._request("GET", "/clips", params=params, token=token)).get("data", [])

    def get_clip_download_urls(self, user_token: str, editor_id: str, broadcaster_id: str, clip_ids: list[str]) -> list[dict]:
        """Endpoint oficial de descarga de clips: solo para el propietario o sus editores
        (scopes editor:manage:clips o channel:manage:clips). Si no está permitido, se lanza TwitchError."""
        params = [("editor_id", editor_id), ("broadcaster_id", broadcaster_id)] + [("clip_id", c) for c in clip_ids]
        return self._json(self._request("GET", "/clips/downloads", token=user_token, params=params)).get("data", [])

    def create_eventsub_subscription(self, user_token: str, session_id: str, type_: str, condition: dict) -> dict:
        body = {"type": type_, "version": "1", "condition": condition,
                "transport": {"method": "websocket", "session_id": session_id}}
        return self._json(self._request("POST", "/eventsub/subscriptions", token=user_token, json=body))


_client: TwitchClient | None = None


def get_twitch() -> TwitchClient:
    global _client
    if _client is None:
        _client = TwitchClient()
    return _client


def set_twitch(client: TwitchClient | None) -> None:
    global _client
    _client = client
