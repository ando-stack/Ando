"""Audio: normalización (loudnorm), reducción de ruido suave, tramos de voz para el ducking,
y listado de música / efectos aportados por el usuario."""
from __future__ import annotations

from pathlib import Path

from config import ASSETS_DIR
from utils import run

AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


def process_source_audio(proj_dir: Path, source: dict, normalize: bool, denoise: bool, cancel=None,
                         codec: str = "h264") -> str | None:
    """Genera audio/{id}_proc.m4a a partir del original (que nunca se modifica)."""
    if not source.get("hasAudio"):
        return None
    filters = []
    if denoise:
        filters += ["highpass=f=70", "afftdn=nr=10:nf=-40"]
    if normalize:
        filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    tag = f"{'n' if normalize else ''}{'d' if denoise else ''}" or "raw"
    rel = f"audio/{source['id']}_{tag}{'.webm' if codec == 'vp9' else '.m4a'}"
    dst = proj_dir / rel
    if dst.exists():
        return rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-i", str(proj_dir / source["original"]), "-vn", "-map", "0:a:0"]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += ["-ar", "48000", "-ac", "2", *(["-c:a", "libopus", "-b:a", "160k"] if codec == "vp9"
                                          else ["-c:a", "aac", "-b:a", "192k"]), str(dst)]
    run(cmd, proj_dir, f"audio {source['name']}", cancel=cancel)
    return rel


def speech_ranges(words: list[dict], gap: float = 0.6) -> list[list[float]]:
    """Tramos con voz (tiempo de salida) uniendo palabras cercanas; se usan para el ducking."""
    out: list[list[float]] = []
    for w in sorted(words, key=lambda x: x["start"]):
        a, b = w["start"] - 0.1, w["end"] + 0.15
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([max(0.0, a), b])
    return [[round(a, 3), round(b, 3)] for a, b in out]


def list_library(kind: str) -> list[str]:
    folder = ASSETS_DIR / ("music" if kind == "music" else "sfx")
    if not folder.exists():
        return []
    return sorted(p.name for p in folder.iterdir() if p.suffix.lower() in AUDIO_EXT)
