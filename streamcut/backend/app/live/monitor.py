"""Servicio de monitorización (proceso independiente o dentro de la API en modo all-in-one).

Responsabilidades:
- Consultar periódicamente el estado de los canales seguidos (y reaccionar a EventSub).
- AUTO PILOT: al detectar una emisión de un canal con piloto automático, iniciar la monitorización.
- Por cada sesión monitorizada: chat (si está permitido), ingesta autorizada + análisis incremental
  (FULL_ANALYSIS) o clips oficiales (PLATFORM_CLIPS).
- Control de recursos: límite de ingestas simultáneas con cola por prioridad.
- Latido (worker_heartbeats) y estadísticas en vivo para el panel AI LIVE DETECTION.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import or_, select

from app.analysis.chat import CHAT_DELAY, ChatSpikeDetector
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.core.security import decrypt
from app.db.models import Channel, ChannelConnection, StreamSession, WorkerHeartbeat, utcnow
from app.db.session import SessionLocal
from app.services.bus import publish
from app.services.channels import refresh_capabilities, refresh_status, source_connection
from app.services.jobs import record_event, write_log
from app.services.settings import get_settings_data

from .analyzer import IncrementalAnalyzer
from .chat_listeners import twitch_chat, youtube_chat
from .ingest import LiveIngest

log = logging.getLogger(__name__)


def resource_usage() -> dict:
    try:
        import psutil
        vm = psutil.virtual_memory()
        du = psutil.disk_usage(str(get_settings().data_dir))
        return {"cpu_percent": psutil.cpu_percent(interval=None), "mem_percent": vm.percent,
                "disk_free_gb": round(du.free / 1024**3, 1), "disk_percent": du.percent,
                "gpu": _gpu()}
    except Exception:
        return {}


def _gpu() -> str | None:
    try:
        import ctranslate2
        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else None
    except Exception:
        return None


@dataclass
class SessionRunner:
    session_id: uuid.UUID
    channel_id: uuid.UUID
    workspace_id: uuid.UUID
    platform: str
    login: str
    mode: str
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    tasks: list[asyncio.Task] = field(default_factory=list)
    ingest: LiveIngest | None = None
    analyzer: IncrementalAnalyzer | None = None
    chat: ChatSpikeDetector = field(default_factory=ChatSpikeDetector)
    chat_log: list[tuple[float, str]] = field(default_factory=list)
    chat_count: int = 0
    events: int = 0
    candidates: int = 0
    platform_clips: int = 0
    started: float = field(default_factory=time.time)
    status: str = "starting"
    note: str | None = None
    clip_delay: float = 8.0


class Monitor:
    def __init__(self) -> None:
        self.runners: dict[uuid.UUID, SessionRunner] = {}
        self.id = f"monitor:{socket.gethostname()}:{os.getpid()}"
        self._last_poll = 0.0
        self._last_maint = 0.0
        self._stopping = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    # -- ciclo principal ---------------------------------------------------------
    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        log.info("Monitor iniciado (%s)", self.id)
        try:
            from .eventsub import EventSubManager
            self.eventsub = EventSubManager(on_event=self._on_eventsub)
            self.tasks = [asyncio.create_task(self.eventsub.run(self._stopping))]
        except Exception as exc:  # pragma: no cover
            log.warning("EventSub no disponible: %s", exc)
            self.tasks = []
        while not self._stopping.is_set():
            try:
                await self.tick()
            except Exception:
                log.exception("Error en el ciclo del monitor")
            try:
                await asyncio.wait_for(self._stopping.wait(), 3)
            except asyncio.TimeoutError:
                pass
        for r in list(self.runners.values()):
            await self.stop_runner(r)
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    def shutdown(self) -> None:
        # Puede llamarse desde otro hilo (modo all-in-one): hay que despertar a su propio bucle.
        loop = self._loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(self._stopping.set)
        else:
            self._stopping.set()

    async def _on_eventsub(self, channel_user_id: str, kind: str) -> None:
        log.info("EventSub %s para %s", kind, channel_user_id)
        self._last_poll = 0  # fuerza una consulta inmediata

    async def tick(self) -> None:
        s = get_settings()
        now = time.time()
        if now - self._last_poll >= s.monitor_poll_seconds:
            self._last_poll = now
            await asyncio.to_thread(self._poll_channels)
        if now - self._last_maint >= 3600:
            self._last_maint = now
            try:
                from app.workers.dispatch import enqueue_maintenance
                enqueue_maintenance()
            except Exception as exc:
                log.warning("No se pudo encolar mantenimiento: %s", exc)
        await self._reconcile()
        await asyncio.to_thread(self._heartbeat)

    def _poll_channels(self) -> None:
        with SessionLocal() as db:
            monitored = select(StreamSession.channel_id).where(StreamSession.monitoring.is_(True),
                                                                StreamSession.status == "live")
            chans = list(db.scalars(select(Channel).where(or_(Channel.is_tracked.is_(True),
                                                              Channel.id.in_(monitored)))))
            if not chans:
                return
            refresh_status(db, chans)
            for c in chans:
                refresh_capabilities(db, c)
                if c.status != "online":
                    continue
                ap = {**get_settings_data(db, c.workspace_id)["autopilot"], **(c.autopilot or {})}
                if not ap.get("enabled"):
                    continue
                sess = db.scalar(select(StreamSession).where(StreamSession.channel_id == c.id,
                                                             StreamSession.status == "live"))
                if sess and not sess.monitoring and not (sess.stats or {}).get("manually_stopped"):
                    sess.monitoring = True
                    sess.capability_mode = c.capabilities.get("mode", "VIEW_ONLY")
                    record_event(db, workspace_id=c.workspace_id, type="autopilot_start",
                                 label=f"AUTO PILOT: monitorización iniciada para {c.display_name}",
                                 channel_id=c.id, stream_session_id=sess.id)
                    db.commit()

    async def _reconcile(self) -> None:
        def load() -> list[tuple[StreamSession, Channel, ChannelConnection | None]]:
            with SessionLocal() as db:
                rows = db.execute(select(StreamSession, Channel).join(Channel, Channel.id == StreamSession.channel_id)
                                  .where(StreamSession.monitoring.is_(True), StreamSession.status == "live")
                                  .order_by(Channel.priority.asc(), StreamSession.started_at.asc())).all()
                return [(sess, ch, source_connection(db, ch)) for sess, ch in rows]

        wanted = await asyncio.to_thread(load)
        wanted_ids = {sess.id for sess, _, _ in wanted}
        for sid in list(self.runners):
            if sid not in wanted_ids:
                await self.stop_runner(self.runners[sid])
        max_ingests = get_settings().max_live_ingests
        active_ingests = sum(1 for r in self.runners.values() if r.ingest is not None)
        for sess, ch, src in wanted:
            runner = self.runners.get(sess.id)
            if runner is None:
                runner = await self.start_runner(sess, ch)
            elif runner.ingest is None:
                # Las capacidades cambian al añadir credenciales o conectar la cuenta: se aplican sin reiniciar
                runner.mode = (ch.capabilities or {}).get("mode", runner.mode)
            if src is not None and src.rights_confirmed_at and runner.ingest is None:
                if active_ingests < max_ingests:
                    await self.start_ingest(runner, src)
                    active_ingests += 1
                else:
                    runner.note = "En cola: límite de ingestas simultáneas alcanzado"
            if runner.ingest is not None:
                await self.check_ingest(runner)
        for r in self.runners.values():
            self._publish_stats(r)

    # -- runners -------------------------------------------------------------------
    async def start_runner(self, sess: StreamSession, ch: Channel) -> SessionRunner:
        r = SessionRunner(sess.id, ch.id, ch.workspace_id, ch.platform, ch.external_id,
                          (ch.capabilities or {}).get("mode", "VIEW_ONLY"))
        with SessionLocal() as db:
            ap = {**get_settings_data(db, ch.workspace_id)["autopilot"], **(ch.autopilot or {})}
        sens = max(0.5, min(2.0, float(ap.get("sensitivity", 1.0))))
        r.clip_delay = max(0.0, min(30.0, float(ap.get("clip_delay_s", 8))))
        r.chat = ChatSpikeDetector(z_threshold=3.0 / sens,
                                   cooldown_s=max(10.0, min(600.0, float(ap.get("clip_cooldown_s", 30)))),
                                   min_emotes=max(4, round(8 / sens)),
                                   rate_trigger=bool(ap.get("chat_rate_clips", False)))
        self.runners[sess.id] = r
        if ch.platform == "twitch":
            r.tasks.append(asyncio.create_task(twitch_chat(ch.external_id, lambda t, u, m: self._on_chat(r, t, m, u),
                                                           r.stop)))
        elif ch.platform == "youtube" and ch.live_video_id:
            r.tasks.append(asyncio.create_task(youtube_chat(ch.live_video_id, lambda t, u, m: self._on_chat(r, t, m, u),
                                                            r.stop, on_error=lambda e: setattr(r, "note", e))))
        r.tasks.append(asyncio.create_task(self._chat_loop(r)))
        r.status = "monitoring"
        write_log(ch.workspace_id, "live", sess.id, "info", f"Monitorización iniciada ({r.mode}) para {ch.display_name}")
        return r

    async def stop_runner(self, r: SessionRunner) -> None:
        r.stop.set()
        if r.ingest is not None:
            await r.ingest.stop()
            # el buffer se conserva un tiempo por si hay clips en curso; la limpieza lo borra luego
        for t in r.tasks:
            t.cancel()
        await asyncio.gather(*r.tasks, return_exceptions=True)
        self.runners.pop(r.session_id, None)
        r.status = "stopped"
        self._publish_stats(r)
        write_log(r.workspace_id, "live", r.session_id, "info", "Monitorización detenida")

    def _on_chat(self, r: SessionRunner, t: float, text: str, user: str | None = None) -> None:
        r.chat_count += 1
        r.chat.add(t, text, user)
        rel = t - (r.ingest.started_wall if r.ingest else r.started)
        r.chat_log.append((rel, text))
        if len(r.chat_log) > 20000:
            r.chat_log = r.chat_log[-10000:]

    async def _chat_loop(self, r: SessionRunner) -> None:
        while not r.stop.is_set():
            await asyncio.sleep(2)
            spike = r.chat.check(time.time())
            if not spike:
                continue
            r.events += 1
            if spike.get("kind") == "emotes":
                label = (f"Spam de «{spike['top']}» en el chat ({spike['top_count']} de {spike['messages']} "
                         f"mensajes en 10 s)")
            else:
                label = (f"Aumento de actividad del chat: {spike['rate']} msg/s "
                         f"(normal {spike['baseline']}), {spike['laugh']} risas, {spike['hype']} hype")
            await asyncio.to_thread(self._record, r, "chat_spike", label, spike)
            peak_wall = time.time() - CHAT_DELAY
            if r.ingest is not None and r.ingest.running:
                await self._enqueue_live_clip(r, peak_wall - r.ingest.started_wall, peak_wall,
                                              "Pico de actividad del chat")
            elif r.mode == "PLATFORM_CLIPS":
                ok = await asyncio.to_thread(self._autopilot_allows_platform_clip, r)
                if ok:
                    # No bloquea la detección: espera unos segundos para que el clip incluya el momento y la reacción
                    r.tasks.append(asyncio.create_task(self._delayed_platform_clip(r, peak_wall, spike)))

    async def _delayed_platform_clip(self, r: SessionRunner, peak_wall: float, spike: dict) -> None:
        from .clipper import create_platform_clip
        if r.clip_delay > 0:
            try:
                await asyncio.wait_for(r.stop.wait(), r.clip_delay)
                return  # la monitorización se detuvo mientras esperaba
            except asyncio.TimeoutError:
                pass
        clip = await asyncio.to_thread(create_platform_clip, r.session_id, "chat_spike", peak_wall, spike)
        if clip:
            r.platform_clips += 1

    def _autopilot_allows_platform_clip(self, r: SessionRunner) -> bool:
        with SessionLocal() as db:
            ch = db.get(Channel, r.channel_id)
            ap = {**get_settings_data(db, ch.workspace_id)["autopilot"], **(ch.autopilot or {})}
            return bool(ap.get("create_platform_clips", True)) and r.platform_clips < int(ap.get("max_clips_per_stream", 20))

    def _record(self, r: SessionRunner, type_: str, label: str, data: dict, t_start=None, t_end=None,
                confidence=None, value=None) -> None:
        with SessionLocal() as db:
            record_event(db, workspace_id=r.workspace_id, type=type_, label=label, channel_id=r.channel_id,
                         stream_session_id=r.session_id, data=data, t_start=t_start, t_end=t_end,
                         confidence=confidence, value=value)
            db.commit()

    async def start_ingest(self, r: SessionRunner, src: ChannelConnection) -> None:
        ing = LiveIngest(str(r.session_id), src.source_mode or "pull", url=decrypt(src.source_url_enc),
                         listen_port=src.listen_port, stream_key=decrypt(src.stream_key_enc))
        try:
            await ing.start()
        except Exception as exc:
            r.note = f"No se pudo iniciar la fuente autorizada: {exc}"
            await asyncio.to_thread(self._mark_source_error, src.id, str(exc))
            return
        with SessionLocal() as db:
            ap = {}
            ch = db.get(Channel, r.channel_id)
            if ch:
                ap = {**get_settings_data(db, ch.workspace_id)["autopilot"], **(ch.autopilot or {})}
        r.ingest = ing
        r.analyzer = IncrementalAnalyzer(sensitivity=float(ap.get("sensitivity", 1.0)), wall_origin=ing.started_wall)
        r.mode = "FULL_ANALYSIS"
        r.note = "Esperando señal…" if ing.mode == "listen" else "Conectando con la fuente…"
        await asyncio.to_thread(self._record, r, "analysis_started",
                                "Análisis audiovisual iniciado con fuente autorizada", {"mode": ing.mode})

    def _mark_source_error(self, conn_id: uuid.UUID, error: str) -> None:
        with SessionLocal() as db:
            c = db.get(ChannelConnection, conn_id)
            if c:
                c.status, c.last_error = "error", error[:1000]
                db.commit()

    async def check_ingest(self, r: SessionRunner) -> None:
        ing, an = r.ingest, r.analyzer
        assert ing is not None and an is not None
        if not ing.running:
            ing.restarts += 1
            r.note = "Fuente desconectada; reintentando… " + (ing.stderr_tail[-1][:160] if ing.stderr_tail else "")
            if ing.restarts <= 1000:
                await asyncio.sleep(min(30, 2 * ing.restarts))
                try:
                    await ing.start()
                    an.wall_origin = ing.started_wall
                except Exception as exc:
                    r.note = str(exc)
            return
        segs = ing.segments()
        new = [s for s in segs if s.index > an.processed_index and s.path.exists()]
        if new:
            r.note = None
        for s in new:
            await asyncio.to_thread(an.feed, s)
        if new:
            triggers, events = await asyncio.to_thread(an.step)
            for ev in events:
                r.events += 1
                await asyncio.to_thread(self._record, r, ev.type, ev.label, {}, ev.start, ev.end, ev.confidence,
                                        ev.value)
            for trg in triggers:
                await self._enqueue_live_clip(r, trg.peak, trg.peak_wall, trg.reason)
            ing.prune(get_settings().live_buffer_minutes * 60)
            await asyncio.to_thread(self._save_session_progress, r)

    async def _enqueue_live_clip(self, r: SessionRunner, peak: float, peak_wall: float, reason: str) -> None:
        from app.workers.dispatch import enqueue_live_clip
        r.candidates += 1
        chat = [(t, m) for t, m in r.chat_log if peak - 60 <= t <= peak + 40]
        payload = {"peak": peak, "peak_wall": peak_wall, "reason": reason,
                   "wall_origin": r.ingest.started_wall if r.ingest else r.started, "chat": chat}
        await asyncio.to_thread(self._record, r, "moment", f"Posible momento destacado: {reason}",
                                {"peak": peak}, peak, None)
        enqueue_live_clip(r.session_id, payload)

    def _save_session_progress(self, r: SessionRunner) -> None:
        with SessionLocal() as db:
            sess = db.get(StreamSession, r.session_id)
            if sess and r.analyzer:
                sess.analyzed_seconds = r.analyzer.analyzed_seconds
                sess.capability_mode = r.mode
                db.commit()

    def _publish_stats(self, r: SessionRunner) -> None:
        publish(r.workspace_id, "live_stats", self.stats(r))

    def stats(self, r: SessionRunner) -> dict:
        return {
            "session_id": str(r.session_id), "channel_id": str(r.channel_id), "status": r.status, "mode": r.mode,
            "media_access": bool(r.ingest and r.ingest.running), "chat_messages": r.chat_count,
            "chat_connected": r.chat_count > 0, "events": r.events, "candidates": r.candidates,
            "analyzed_seconds": round(r.analyzer.analyzed_seconds, 1) if r.analyzer else 0.0,
            "buffer_seconds": round(r.analyzer.end - r.analyzer.window_start, 1) if r.analyzer else 0.0,
            "platform_clips": r.platform_clips, "note": r.note, "resources": resource_usage(),
            "uptime": round(time.time() - r.started, 1),
        }

    def _heartbeat(self) -> None:
        with SessionLocal() as db:
            hb = db.get(WorkerHeartbeat, self.id)
            info = {"sessions": [self.stats(r) for r in self.runners.values()], "resources": resource_usage()}
            if hb is None:
                db.add(WorkerHeartbeat(id=self.id, kind="monitor", hostname=socket.gethostname(), pid=os.getpid(),
                                       info=info))
            else:
                hb.last_seen_at = utcnow()
                hb.info = info
            db.commit()


def main() -> None:  # pragma: no cover - punto de entrada del proceso
    setup_logging()
    from app.workers import broker  # noqa: F401
    monitor = Monitor()
    try:
        asyncio.run(monitor.run())
    except KeyboardInterrupt:
        monitor.shutdown()


if __name__ == "__main__":  # pragma: no cover
    main()
