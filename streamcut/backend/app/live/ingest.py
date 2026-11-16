"""Ingesta en directo de una señal AUTORIZADA en un buffer circular de segmentos.

Dos modos:
- pull:   FFmpeg lee una URL RTMP/RTMPS/SRT/HLS validada (anti-SSRF y lista blanca de protocolos).
- listen: FFmpeg actúa como servidor RTMP local (rtmp://<host>:<puerto>/live/<clave>) al que tu
          propio OBS envía la emisión (salida adicional o plugin multi-RTMP).

Los segmentos MPEG-TS de N segundos se guardan en data/live/<sesión>/ y se borran al salir de la
ventana del buffer (STREAMCUT_LIVE_BUFFER_MINUTES).
"""

from __future__ import annotations

import asyncio
import csv
import logging
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import get_settings
from app.core.netsafe import FFMPEG_PROTOCOL_WHITELIST, validate_source_url
from app.media.ffmpeg import ffmpeg_bin

log = logging.getLogger(__name__)


@dataclass
class LiveSegment:
    index: int
    path: Path
    start: float  # segundos desde el inicio de la captura
    end: float
    wall_start: float  # epoch aproximado en que empezó el segmento

    @property
    def duration(self) -> float:
        return self.end - self.start


def session_dir(session_id: str) -> Path:
    return get_settings().data_dir / "live" / session_id


def read_segment_list(directory: Path, wall_origin: float) -> list[LiveSegment]:
    lst = directory / "segments.csv"
    out: list[LiveSegment] = []
    if not lst.exists():
        return out
    with open(lst, newline="") as f:
        for i, row in enumerate(csv.reader(f)):
            if len(row) < 3:
                continue
            p = directory / row[0]
            try:
                start, end = float(row[1]), float(row[2])
            except ValueError:
                continue
            idx = int(p.stem.split("_")[-1]) if p.stem.split("_")[-1].isdigit() else i
            out.append(LiveSegment(idx, p, start, end, wall_origin + start))
    return out


@dataclass
class LiveIngest:
    session_id: str
    mode: str  # pull | listen
    url: str | None = None
    listen_port: int | None = None
    stream_key: str | None = None
    proc: asyncio.subprocess.Process | None = None
    started_wall: float = 0.0
    last_error: str | None = None
    restarts: int = 0
    stderr_tail: list[str] = field(default_factory=list)

    @property
    def directory(self) -> Path:
        return session_dir(self.session_id)

    def command(self) -> list[str]:
        s = get_settings()
        d = self.directory
        cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-loglevel", "warning"]
        if self.mode == "listen":
            cmd += ["-listen", "1", "-timeout", "-1",
                    "-i", f"rtmp://{s.rtmp_listen_host}:{self.listen_port}/live/{self.stream_key}"]
        else:
            assert self.url
            url = validate_source_url(self.url)
            cmd += ["-protocol_whitelist", FFMPEG_PROTOCOL_WHITELIST, "-rw_timeout", "15000000"]
            if url.startswith(("file:", "/")):  # nunca llega aquí (validate_source_url lo impide)
                raise ValueError("Fuente no permitida")
            cmd += ["-i", url]
        cmd += ["-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
                "-f", "segment", "-segment_time", str(s.live_segment_seconds), "-segment_format", "mpegts",
                "-reset_timestamps", "0", "-segment_list", str(d / "segments.csv"), "-segment_list_type", "csv",
                "-segment_list_flags", "+live", str(d / "seg_%06d.ts")]
        return cmd

    async def start(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        self.started_wall = time.time()
        self.proc = await asyncio.create_subprocess_exec(*self.command(), stdin=asyncio.subprocess.DEVNULL,
                                                         stdout=asyncio.subprocess.DEVNULL,
                                                         stderr=asyncio.subprocess.PIPE)
        asyncio.create_task(self._read_stderr())

    async def _read_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        async for line in self.proc.stderr:
            txt = line.decode(errors="replace").strip()
            if txt:
                self.stderr_tail = (self.stderr_tail + [txt])[-20:]

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.terminate()
                await asyncio.wait_for(self.proc.wait(), 10)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self.proc.kill()
                except ProcessLookupError:
                    pass

    def segments(self) -> list[LiveSegment]:
        return read_segment_list(self.directory, self.started_wall)

    def prune(self, keep_seconds: float) -> int:
        segs = self.segments()
        if not segs:
            return 0
        cutoff = segs[-1].end - keep_seconds
        removed = 0
        for s in segs:
            if s.end < cutoff and s.path.exists():
                s.path.unlink(missing_ok=True)
                removed += 1
        return removed

    def cleanup(self) -> None:
        shutil.rmtree(self.directory, ignore_errors=True)
