"""Directo con señal autorizada: un "OBS" (FFmpeg) emite por RTMP al servidor local de STREAMCUT,
el monitor graba el buffer circular, detecta el momento en tiempo real y crea el clip."""

from __future__ import annotations

import asyncio
import socket
import subprocess
import threading
import time

import pytest
from sqlalchemy import select

from app.core.security import encrypt
from app.db.models import Channel, ChannelConnection, Clip, DetectedEvent, StreamSession, utcnow
from app.db.session import SessionLocal
from app.live.analyzer import IncrementalAnalyzer
from app.live.ingest import LiveIngest


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def push(video, port, key, rate=4.0) -> subprocess.Popen:
    return subprocess.Popen(["ffmpeg", "-v", "error", "-readrate", str(rate), "-i", str(video), "-c:v", "libx264",
                             "-preset", "ultrafast", "-g", "30", "-c:a", "aac", "-f", "flv",
                             f"rtmp://127.0.0.1:{port}/live/{key}"])


def test_ring_buffer_and_incremental_detection(highlight_video, tmp_path):
    port = free_port()

    async def run():
        ing = LiveIngest("test-buffer", "listen", listen_port=port, stream_key="k1")
        await ing.start()
        await asyncio.sleep(1.0)
        proc = push(highlight_video, port, "k1")
        an = IncrementalAnalyzer(wall_origin=time.time())
        triggers, events = [], []
        deadline = time.time() + 90
        while time.time() < deadline:
            await asyncio.sleep(1)
            for s in ing.segments():
                if s.index > an.processed_index and s.path.exists():
                    an.feed(s)
            t, e = an.step()
            triggers += t
            events += e
            if proc.poll() is not None and an.end >= 86:
                break
        removed = ing.prune(30)
        await ing.stop()
        proc.wait(10)
        return ing, triggers, events, removed

    ing, triggers, events, removed = asyncio.run(run())
    assert triggers, "debe confirmarse el momento destacado durante la emisión"
    assert any(38 <= t.peak <= 48 for t in triggers), [t.peak for t in triggers]
    assert any(e.type == "loud_reaction" for e in events)
    assert removed > 0  # el buffer circular descarta segmentos antiguos
    ing.cleanup()


def test_monitor_full_analysis_end_to_end(auth_client, worker, highlight_video):
    """Monitor real + workers: canal con fuente autorizada (RTMP local) → clip renderizado."""
    from app.live.monitor import Monitor
    from app.services.channels import refresh_capabilities

    port = free_port()
    ws_id = None
    with SessionLocal() as db:
        from app.db.models import Workspace
        ws = db.scalar(select(Workspace))
        ws_id = ws.id
        ch = Channel(workspace_id=ws.id, platform="twitch", external_id="streamcut_test_obs",
                     display_name="Mi canal", url="https://www.twitch.tv/streamcut_test_obs", status="unknown",
                     autopilot={"min_score": 30, "template_slug": "clean"})
        db.add(ch)
        db.flush()
        db.add(ChannelConnection(workspace_id=ws.id, channel_id=ch.id, platform="twitch", kind="authorized_source",
                                 source_mode="listen", listen_port=port, stream_key_enc=encrypt("clave-obs"),
                                 rights_confirmed_at=utcnow()))
        db.commit()
        caps = refresh_capabilities(db, ch)
        assert caps["mode"] == "FULL_ANALYSIS"
        ch_id = ch.id
    # El usuario pulsa INICIAR MONITORIZACIÓN
    r = auth_client.post(f"/api/live/{ch_id}/start")
    assert r.status_code == 200, r.text

    monitor = Monitor()
    loop = asyncio.new_event_loop()
    th = threading.Thread(target=lambda: loop.run_until_complete(monitor.run()), daemon=True)
    th.start()
    try:
        time.sleep(4)
        proc = push(highlight_video, port, "clave-obs")
        deadline = time.time() + 240
        clip = None
        while time.time() < deadline:
            time.sleep(2)
            with SessionLocal() as db:
                clip = db.scalar(select(Clip).where(Clip.channel_id == ch_id, Clip.origin == "live"))
            if clip is not None:
                break
        proc.wait(30)
        assert clip is not None, "el monitor debía crear un clip durante la emisión"
        worker.drain()
        st = auth_client.get("/api/live/status", params={"channel_id": str(ch_id)}).json()
        assert st["monitor_alive"] is True
        assert st["session"]["clips"] >= 1
    finally:
        loop.call_soon_threadsafe(monitor.shutdown)
        th.join(30)
    with SessionLocal() as db:
        clip = db.get(Clip, clip.id)
        assert clip.status == "pending" and clip.detection_latency_s is not None and clip.detection_latency_s > 0
        assert clip.stream_session_id is not None and clip.score >= 30
        types = {e.type for e in db.scalars(select(DetectedEvent).where(DetectedEvent.channel_id == ch_id))}
        assert {"monitoring_start", "analysis_started", "loud_reaction", "moment", "candidate"} <= types, types
    detail = auth_client.get(f"/api/clips/{clip.id}").json()
    assert detail["video_url"] and detail["versions"][0]["status"] == "ready"
    assert detail["ready_latency_s"] is not None
    auth_client.post(f"/api/live/{ch_id}/stop")
    with SessionLocal() as db:
        sess = db.scalar(select(StreamSession).where(StreamSession.channel_id == ch_id))
        assert sess.monitoring is False
