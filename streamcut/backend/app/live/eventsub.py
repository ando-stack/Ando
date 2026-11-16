"""EventSub de Twitch por WebSocket (stream.online / stream.offline).

Requiere un token de USUARIO (cuenta conectada por OAuth). Si no hay ninguno, el monitor sigue
funcionando con consultas periódicas a Helix. Gestiona session_welcome, keepalive, reconnect y
revocation según la documentación de Twitch.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

from sqlalchemy import select

from app.db.models import Channel, ChannelConnection
from app.db.session import SessionLocal
from app.integrations.twitch import TwitchError, get_twitch
from app.services.channels import valid_user_token

log = logging.getLogger(__name__)
WS_URL = "wss://eventsub.wss.twitch.tv/ws"


class EventSubManager:
    def __init__(self, on_event: Callable[[str, str], Awaitable[None]]):
        self.on_event = on_event
        self.subscribed: set[str] = set()

    def _credentials(self) -> tuple[str, list[str]] | None:
        with SessionLocal() as db:
            conn = db.scalar(select(ChannelConnection).where(ChannelConnection.platform == "twitch",
                                                             ChannelConnection.kind == "oauth_user",
                                                             ChannelConnection.status == "active"))
            if conn is None:
                return None
            token = valid_user_token(db, conn)
            ids = [c.platform_user_id for c in db.scalars(select(Channel).where(
                Channel.platform == "twitch", Channel.is_tracked.is_(True), Channel.workspace_id == conn.workspace_id))
                if c.platform_user_id]
            return (token, ids) if token else None

    async def run(self, stop: asyncio.Event) -> None:
        if not get_twitch().configured:
            return
        import websockets
        url = WS_URL
        backoff = 5.0
        while not stop.is_set():
            creds = await asyncio.to_thread(self._credentials)
            if not creds or not creds[1]:
                try:
                    await asyncio.wait_for(stop.wait(), 120)
                except asyncio.TimeoutError:
                    pass
                continue
            token, ids = creds
            try:
                async with websockets.connect(url, open_timeout=15) as ws:
                    keepalive = 30.0
                    while not stop.is_set():
                        raw = await asyncio.wait_for(ws.recv(), timeout=keepalive + 15)
                        msg = json.loads(raw)
                        mtype = msg.get("metadata", {}).get("message_type")
                        payload = msg.get("payload", {})
                        if mtype == "session_welcome":
                            sess = payload["session"]
                            keepalive = float(sess.get("keepalive_timeout_seconds") or 30)
                            self.subscribed.clear()
                            for uid in ids:
                                for t in ("stream.online", "stream.offline"):
                                    try:
                                        await asyncio.to_thread(get_twitch().create_eventsub_subscription, token,
                                                                sess["id"], t, {"broadcaster_user_id": uid})
                                        self.subscribed.add(f"{t}:{uid}")
                                    except TwitchError as exc:
                                        log.warning("EventSub %s %s: %s", t, uid, exc)
                            backoff = 5.0
                        elif mtype == "notification":
                            ev = payload.get("event", {})
                            sub_type = payload.get("subscription", {}).get("type", "")
                            await self.on_event(ev.get("broadcaster_user_id", ""), sub_type)
                        elif mtype == "session_reconnect":
                            url = payload["session"]["reconnect_url"]
                            break
                        elif mtype == "revocation":
                            log.warning("EventSub revocado: %s", payload.get("subscription", {}).get("status"))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("EventSub desconectado: %s", exc)
                url = WS_URL
                try:
                    await asyncio.wait_for(stop.wait(), backoff)
                except asyncio.TimeoutError:
                    pass
                backoff = min(300.0, backoff * 2)
