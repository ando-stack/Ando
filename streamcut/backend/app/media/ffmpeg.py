"""Envoltorio de FFmpeg/FFprobe: metadatos, validación, proxies, audio, miniaturas y waveforms."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.core.config import get_settings

log = logging.getLogger(__name__)

ALLOWED_CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "mpegts", "flv"}
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


class MediaError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


def ffmpeg_bin() -> str:
    b = get_settings().ffmpeg_bin
    return shutil.which(b) or b


def ffprobe_bin() -> str:
    b = get_settings().ffprobe_bin
    return shutil.which(b) or b


def run(cmd: list[str], *, timeout: float | None = None,
        cancel: Callable[[], bool] | None = None,
        progress: Callable[[float], None] | None = None, duration: float | None = None) -> str:
    """Ejecuta ffmpeg con cancelación y progreso (lee `-progress pipe:2`)."""
    log.debug("ffmpeg: %s", " ".join(cmd))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                            text=True, errors="replace")
    tail: list[str] = []
    stop = threading.Event()

    def _watch() -> None:
        while not stop.wait(0.5):
            if cancel and cancel():
                proc.kill()
                return

    watcher = threading.Thread(target=_watch, daemon=True)
    watcher.start()
    assert proc.stderr is not None
    for line in proc.stderr:
        tail.append(line)
        if len(tail) > 60:
            tail.pop(0)
        if progress and duration and line.startswith("out_time_us="):
            try:
                us = int(line.split("=", 1)[1])
                progress(min(1.0, us / 1e6 / duration))
            except ValueError:
                pass
    try:
        proc.wait(timeout=timeout)
    finally:
        stop.set()
    if cancel and cancel():
        raise Cancelled("Cancelado")
    if proc.returncode != 0:
        msg = "".join(l for l in tail if not l.startswith(("frame=", "out_time", "progress=", "speed=",
                                                            "bitrate=", "total_size", "fps=", "stream_",
                                                            "dup_frames", "drop_frames", "out_time_ms")))
        raise MediaError(f"FFmpeg falló ({proc.returncode}): {msg[-1500:]}")
    return "".join(tail)


@dataclass
class ProbeInfo:
    duration: float
    width: int | None
    height: int | None
    fps: float | None
    has_video: bool
    has_audio: bool
    format_name: str
    video_codec: str | None
    audio_codec: str | None
    raw: dict


def probe(path: Path) -> ProbeInfo:
    cmd = [ffprobe_bin(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=True).stdout
    except subprocess.CalledProcessError as exc:
        raise MediaError(f"El archivo no es un vídeo válido: {exc.stderr.strip()[:300]}") from exc
    data = json.loads(out or "{}")
    streams = data.get("streams", [])
    fmt = data.get("format", {})
    v = next((s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fps = None
    if v and v.get("avg_frame_rate") not in (None, "0/0"):
        num, _, den = v["avg_frame_rate"].partition("/")
        try:
            fps = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            fps = None
    duration = float(fmt.get("duration") or (v or a or {}).get("duration") or 0)
    return ProbeInfo(
        duration=duration,
        width=int(v["width"]) if v and v.get("width") else None,
        height=int(v["height"]) if v and v.get("height") else None,
        fps=round(fps, 3) if fps else None,
        has_video=v is not None, has_audio=a is not None,
        format_name=fmt.get("format_name", ""),
        video_codec=v.get("codec_name") if v else None,
        audio_codec=a.get("codec_name") if a else None,
        raw={"format": {k: fmt.get(k) for k in ("format_name", "duration", "bit_rate", "size")},
             "streams": [{k: s.get(k) for k in ("index", "codec_type", "codec_name", "width", "height",
                                                 "avg_frame_rate", "sample_rate", "channels", "duration")}
                         for s in streams]},
    )


def validate_video(path: Path, filename: str | None = None) -> ProbeInfo:
    if filename:
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise MediaError(f"Formato no admitido ({ext}). Usa MP4, MOV, MKV o WEBM")
    info = probe(path)
    if info.format_name not in ALLOWED_CONTAINERS:
        raise MediaError(f"Contenedor no admitido: {info.format_name}")
    if not info.has_video:
        raise MediaError("El archivo no contiene pista de vídeo")
    if info.duration <= 0.5:
        raise MediaError("El vídeo es demasiado corto o está dañado")
    return info


def video_encoder_args(crf: int = 20, preset: str = "veryfast") -> list[str]:
    enc = get_settings().hwaccel_encoder
    if enc:
        return ["-c:v", enc, "-b:v", "8M", "-pix_fmt", "yuv420p"]
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p"]


def make_proxy(src: Path, dest: Path, height: int, duration: float, *, cancel=None, progress=None) -> None:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-i", str(src),
           "-map", "0:v:0", "-map", "0:a:0?",
           "-vf", f"scale=-2:'min({height},ih)'", *video_encoder_args(28, "veryfast"),
           "-g", "48", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart",
           "-progress", "pipe:2", "-nostats", str(dest)]
    run(cmd, cancel=cancel, progress=progress, duration=duration)


def extract_audio(src: Path, dest: Path, *, sample_rate: int = 16000, cancel=None, progress=None,
                  duration: float | None = None) -> None:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-i", str(src), "-vn", "-ac", "1",
           "-ar", str(sample_rate), "-c:a", "pcm_s16le", "-progress", "pipe:2", "-nostats", str(dest)]
    run(cmd, cancel=cancel, progress=progress, duration=duration)


def thumbnail(src: Path, dest: Path, at: float, width: int = 640) -> None:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-ss", f"{max(0.0, at):.3f}", "-i", str(src),
           "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", str(dest)]
    run(cmd)
    if not dest.exists() or dest.stat().st_size == 0:
        raise MediaError("No se pudo generar la miniatura")


def read_pcm(wav: Path, start: float = 0.0, duration: float | None = None, sr: int = 16000) -> np.ndarray:
    """Lee audio mono float32 [-1,1] del WAV (16 kHz) en el rango indicado."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-v", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(wav)]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-ac", "1", "-ar", str(sr), "-f", "s16le", "pipe:1"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def waveform_peaks(wav: Path, peaks_per_second: int = 20) -> list[float]:
    """Picos normalizados para dibujar la forma de onda en el editor."""
    sr = 16000
    hop = sr // peaks_per_second
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-v", "error", "-i", str(wav), "-ac", "1", "-ar",
           str(sr), "-f", "s16le", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    assert proc.stdout is not None
    peaks: list[float] = []
    rest = b""
    while chunk := proc.stdout.read(hop * 2 * 512):
        chunk = rest + chunk
        usable = len(chunk) - len(chunk) % (hop * 2)
        rest = chunk[usable:]
        if usable:
            x = np.abs(np.frombuffer(chunk[:usable], dtype=np.int16).reshape(-1, hop)).max(axis=1)
            peaks.extend((x / 32768.0).round(4).tolist())
    proc.wait()
    return peaks


def remux_concat(segments: list[Path], dest: Path, start_offset: float, duration: float) -> None:
    """Une segmentos .ts del buffer circular y recorta [start_offset, +duration] recodificando."""
    lst = dest.with_suffix(".txt")
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in segments))
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
           "-ss", f"{max(0.0, start_offset):.3f}", "-t", f"{duration:.3f}",
           "-map", "0:v:0?", "-map", "0:a:0?", *video_encoder_args(18, "veryfast"),
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(dest)]
    try:
        run(cmd)
    finally:
        lst.unlink(missing_ok=True)

