"""Lectores de chat permitidos.

- Twitch: conexión anónima de SOLO LECTURA al IRC oficial (wss://irc-ws.chat.twitch.tv), método
  documentado por Twitch para leer chats públicos sin credenciales ("justinfan").
- YouTube: liveChatMessages.list de la Data API (respeta pollingIntervalMillis; consume cuota).
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable

from app.integrations.youtube import YouTubeError, get_youtube

log = logging.getLogger(__name__)
OnMessage = Callable[[float, str, str], Awaitable[None] | None]
TWITCH_IRC = "wss://irc-ws.chat.twitch.tv:443"


def parse_privmsg(line: str) -> tuple[str, str] | None:
    """Extrae (usuario, texto) de una línea IRC PRIVMSG (con o sin tags)."""
    if " PRIVMSG " not in line:
        return None
    rest = line
    if rest.startswith("@"):
        _, _, rest = rest.partition(" ")
    prefix, _, rest = rest.partition(" PRIVMSG ")
    user = prefix.lstrip(":").split("!", 1)[0]
    _, _, text = rest.partition(" :")
    return user, text


async def twitch_chat(login: str, on_message: OnMessage, stop: asyncio.Event) -> None:
    import websockets

    backoff = 1.0
    while not stop.is_set():
        try:
            async with websockets.connect(TWITCH_IRC, open_timeout=15, ping_interval=None) as ws:
                await ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands")
                await ws.send("PASS SCHMOOPIIE")
                await ws.send(f"NICK justinfan{random.randint(10000, 99999)}")
                await ws.send(f"JOIN #{login.lower()}")
                backoff = 1.0
                while not stop.is_set():
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=360)
                    except asyncio.TimeoutError:
                        await ws.send("PING :tmi.twitch.tv")
                        continue
                    for line in str(raw).split("\r\n"):
                        if not line:
                            continue
                        if line.startswith("PING"):
                            await ws.send("PONG :tmi.twitch.tv")
                        elif " RECONNECT" in line:
                            raise ConnectionError("Twitch pidió reconectar")
                        else:
                            msg = parse_privmsg(line)
                            if msg:
                                r = on_message(time.time(), msg[0], msg[1])
                                if asyncio.iscoroutine(r):
                                    await r
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("Chat de Twitch (%s) desconectado: %s; reintento en %.0fs", login, exc, backoff)
            try:
                await asyncio.wait_for(stop.wait(), backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(60.0, backoff * 2)


async def youtube_chat(video_id: str, on_message: OnMessage, stop: asyncio.Event,
                       on_error: Callable[[str], None] | None = None) -> None:
    yt = get_youtube()
    try:
        video = await asyncio.to_thread(yt.video, video_id)
    except YouTubeError as exc:
        if on_error:
            on_error(str(exc))
        return
    chat_id = (video or {}).get("liveStreamingDetails", {}).get("activeLiveChatId")
    if not chat_id:
        if on_error:
            on_error("El directo no tiene chat en vivo público")
        return
    page = None
    while not stop.is_set():
        try:
            data = await asyncio.to_thread(yt.live_chat_messages, chat_id, page)
        except YouTubeError as exc:
            if on_error:
                on_error(str(exc))
            if exc.reason in ("liveChatEnded", "quotaExceeded", "forbidden", "liveChatDisabled"):
                return
            await asyncio.sleep(30)
            continue
        page = data.get("nextPageToken")
        for item in data.get("items", []):
            sn = item.get("snippet", {})
            text = sn.get("displayMessage") or ""
            author = item.get("authorDetails", {}).get("displayName", "")
            r = on_message(time.time(), author, text)
            if asyncio.iscoroutine(r):
                await r
        wait = max(5.0, data.get("pollingIntervalMillis", 10000) / 1000)
        try:
            await asyncio.wait_for(stop.wait(), wait)
        except asyncio.TimeoutError:
            pass
