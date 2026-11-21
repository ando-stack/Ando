"""FFmpeg / ffprobe helpers. Uploaded files are only ever *read* by ffmpeg,
never executed; arguments are passed as lists (no shell)."""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..config import get_settings

ALLOWED_CONTAINERS = {
    "mov,mp4,m4a,3gp,3g2,mj2": "mp4/mov",
    "matroska,webm": "mkv/webm",
}
BROWSER_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", None}


class VideoError(Exception):
    def __init__(self, message: str, code: str = "invalid_video"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class ProbeResult:
    format_name: str
    duration: float
    width: int
    height: int
    fps: float
    video_codec: str
    audio_codec: str | None
    has_audio: bool
    bitrate: int | None
    raw: dict

    @property
    def browser_playable(self) -> bool:
        return (
            self.video_codec in BROWSER_VIDEO_CODECS
            and self.audio_codec in BROWSER_AUDIO_CODECS
            and self.format_name in ALLOWED_CONTAINERS
        )


def run(args: list[str], timeout: int | None = None, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=capture, timeout=timeout, check=False)


def probe(path: Path) -> ProbeResult:
    s = get_settings()
    proc = run(
        [s.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        timeout=120,
    )
    if proc.returncode != 0:
        raise VideoError("FFmpeg no puede leer el archivo: no es un vídeo válido o está dañado.")
    data = json.loads(proc.stdout or b"{}")
    fmt = data.get("format", {})
    fname = fmt.get("format_name", "")
    if fname not in ALLOWED_CONTAINERS:
        raise VideoError(f"Contenedor no permitido ({fname}). Formatos aceptados: MP4, MOV, MKV, WEBM.", "bad_format")
    vstreams = [st for st in data.get("streams", []) if st.get("codec_type") == "video" and not st.get("disposition", {}).get("attached_pic")]
    if not vstreams:
        raise VideoError("El archivo no contiene ninguna pista de vídeo.", "no_video")
    v = vstreams[0]
    astreams = [st for st in data.get("streams", []) if st.get("codec_type") == "audio"]
    duration = float(fmt.get("duration") or v.get("duration") or 0)
    if duration <= 0:
        raise VideoError("No se pudo determinar la duración del vídeo.")
    num, _, den = (v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    return ProbeResult(
        format_name=fname,
        duration=duration,
        width=int(v.get("width") or 0),
        height=int(v.get("height") or 0),
        fps=round(fps, 3),
        video_codec=v.get("codec_name", "unknown"),
        audio_codec=astreams[0].get("codec_name") if astreams else None,
        has_audio=bool(astreams),
        bitrate=int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        raw={"format": {k: fmt.get(k) for k in ("format_name", "duration", "bit_rate", "size")}},
    )


def make_proxy(src: Path, dest: Path, on_progress=None, duration: float | None = None) -> None:
    """Transcode to H.264/AAC MP4 (faststart) for in-browser playback.
    Timestamps are preserved, so markers line up with the original file."""
    s = get_settings()
    args = [
        s.ffmpeg, "-y", "-v", "error", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale='min(1920,iw)':-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats", str(dest),
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout
    for line in proc.stdout:
        if on_progress and duration and line.startswith("out_time_us="):
            try:
                on_progress(min(1.0, int(line.split("=")[1]) / 1e6 / duration))
            except ValueError:
                pass
    proc.wait()
    if proc.returncode != 0:
        err = proc.stderr.read() if proc.stderr else ""
        raise VideoError(f"Error al convertir el vídeo para reproducción: {err[-400:]}", "transcode_failed")


def gray_activity(src: Path, duration: float, fps: float = 1.0, w: int = 160, h: int = 90):
    """Per-second visual activity: mean absolute difference between consecutive
    low-res grayscale frames. Returns (times, activity, brightness)."""
    s = get_settings()
    proc = subprocess.Popen(
        [s.ffmpeg, "-v", "error", "-i", str(src), "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    assert proc.stdout
    frame_size = w * h
    prev = None
    act, bright = [], []
    while True:
        buf = proc.stdout.read(frame_size)
        if len(buf) < frame_size:
            break
        cur = np.frombuffer(buf, dtype=np.uint8).astype(np.int16)
        bright.append(float(cur.mean()))
        act.append(0.0 if prev is None else float(np.abs(cur - prev).mean()))
        prev = cur
    proc.wait()
    times = np.arange(len(act)) / fps
    return times, np.array(act), np.array(bright)


def audio_energy(src: Path, rate: int = 8000, window: float = 0.5):
    """RMS energy (dBFS) per window of the first audio track."""
    s = get_settings()
    proc = subprocess.Popen(
        [s.ffmpeg, "-v", "error", "-i", str(src), "-map", "0:a:0", "-ac", "1", "-ar", str(rate), "-f", "s16le", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    assert proc.stdout
    data = proc.stdout.read()
    proc.wait()
    if not data:
        return np.array([]), np.array([])
    pcm = np.frombuffer(data[: len(data) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
    n = int(rate * window)
    k = len(pcm) // n
    if k == 0:
        return np.array([]), np.array([])
    rms = np.sqrt((pcm[: k * n].reshape(k, n) ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    return np.arange(k) * window, db


def extract_frame(src: Path, t: float, dest: Path, width: int) -> bool:
    s = get_settings()
    proc = run(
        [s.ffmpeg, "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
         "-vf", f"scale='min({width},iw)':-2", "-q:v", "3", str(dest)],
        timeout=120,
    )
    return proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0


def extract_audio_wav(src: Path, dest: Path) -> bool:
    s = get_settings()
    proc = run([s.ffmpeg, "-y", "-v", "error", "-i", str(src), "-map", "0:a:0", "-ac", "1", "-ar", "16000", str(dest)], timeout=3600)
    return proc.returncode == 0 and dest.exists()


def ffmpeg_version() -> str | None:
    try:
        out = run([get_settings().ffmpeg, "-version"], timeout=10).stdout.decode()
        return out.splitlines()[0] if out else None
    except (OSError, subprocess.TimeoutExpired):
        return None
