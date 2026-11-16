"""Bus de eventos en tiempo real (para SSE).

- Con Redis: pub/sub en el canal `streamcut:ws:<workspace>` (API, workers y monitor en procesos
  distintos).
- Sin Redis (modo all-in-one / tests): bus en memoria seguro entre hilos.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from app.core.config import get_settings

log = logging.getLogger(__name__)


def _default(o: Any) -> Any:
    if isinstance(o, (uuid.UUID,)):
        return str(o)
    if isinstance(o, datetime):
        return o.isoformat()
    return str(o)


def encode(event_type: str, payload: dict) -> str:
    return json.dumps({"type": event_type, "at": datetime.now(timezone.utc).isoformat(), "data": payload},
                      default=_default)


class LocalBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
        self._lock = threading.Lock()

    def publish(self, workspace_id: str, message: str) -> None:
        with self._lock:
            subs = list(self._subs.get(workspace_id, []))
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(q.put_nowait, message)
            except RuntimeError:
                pass

    async def subscribe(self, workspace_id: str) -> AsyncIterator[str]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        entry = (loop, q)
        with self._lock:
            self._subs.setdefault(workspace_id, []).append(entry)
        try:
            while True:
                yield await q.get()
        finally:
            with self._lock:
                self._subs.get(workspace_id, []).remove(entry)


class RedisBus:
    def __init__(self, url: str) -> None:
        import redis
        self.url = url
        self._client = redis.Redis.from_url(url)

    def publish(self, workspace_id: str, message: str) -> None:
        try:
            self._client.publish(f"streamcut:ws:{workspace_id}", message)
        except Exception as exc:  # el bus nunca debe tumbar un trabajo
            log.warning("No se pudo publicar evento: %s", exc)

    async def subscribe(self, workspace_id: str) -> AsyncIterator[str]:
        import redis.asyncio as aioredis
        client = aioredis.Redis.from_url(self.url)
        pubsub = client.pubsub()
        await pubsub.subscribe(f"streamcut:ws:{workspace_id}")
        try:
            async for msg in pubsub.listen():
                if msg.get("type") == "message":
                    data = msg["data"]
                    yield data.decode() if isinstance(data, bytes) else data
        finally:
            await pubsub.unsubscribe()
            await client.aclose()


_bus: LocalBus | RedisBus | None = None


def get_bus() -> LocalBus | RedisBus:
    global _bus
    if _bus is None:
        s = get_settings()
        _bus = RedisBus(s.redis_url) if s.broker == "redis" else LocalBus()
    return _bus


def reset_bus() -> None:
    global _bus
    _bus = None


def publish(workspace_id: uuid.UUID | str | None, event_type: str, payload: dict) -> None:
    if workspace_id is None:
        return
    get_bus().publish(str(workspace_id), encode(event_type, payload))
