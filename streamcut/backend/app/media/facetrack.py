"""Seguimiento de cara para el reencuadre.

1. Detecta caras (YuNet de OpenCV, ver ``faces.py``) a 4 fps en bloques de 10 s del vídeo original.
   Las detecciones en bruto se guardan en caché por vídeo y bloque, así la vista previa del editor y
   el render final no repiten el trabajo.
2. Elige en cada instante la cara a seguir: la más cercana a la anterior (sin saltar entre personas),
   opcionalmente solo dentro de una zona (por ejemplo, la webcam en pantalla dividida).
3. Rellena huecos, suaviza el movimiento con una zona muerta (la cámara no tiembla con movimientos
   pequeños) y devuelve puntos (t, cx, cy) normalizados en tiempo del vídeo original.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

import numpy as np

from .ffmpeg import ffmpeg_bin

log = logging.getLogger(__name__)

CHUNK_S = 10.0
FPS = 4.0
WIDTH = 640
Face = tuple[float, float, float, float]  # cx, cy, w, h (0..1)


def _detect_chunk(src: Path, t0: float, dur: float, size: tuple[int, int]) -> list[list[Face]]:
    from .faces import FaceDetector
    w, h = size
    det = FaceDetector(w, h)
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{dur:.3f}",
           "-i", str(src), "-an", "-sn", "-vf", f"fps={FPS},scale={w}:{h}", "-pix_fmt", "bgr24",
           "-f", "rawvideo", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frames: list[list[Face]] = []
    n = w * h * 3
    assert proc.stdout is not None
    try:
        while True:
            buf = proc.stdout.read(n)
            if len(buf) < n:
                break
            img = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
            frames.append(det.detect(img) if det.available else [])
    finally:
        proc.stdout.close()
        proc.wait()
    return frames


def detections(src: Path, start: float, end: float, src_w: int | None, src_h: int | None,
               cache_dir: Path | None = None) -> list[tuple[float, list[Face]]]:
    """Caras detectadas entre start y end (tiempo del original), con caché por bloques de 10 s."""
    h = max(2, int(round(WIDTH * (src_h or 9) / (src_w or 16) / 2)) * 2)
    out: list[tuple[float, list[Face]]] = []
    k = int(max(0.0, start) // CHUNK_S)
    while k * CHUNK_S < end:
        t0 = k * CHUNK_S
        cached = cache_dir / f"chunk_{k}.json" if cache_dir else None
        frames = None
        if cached and cached.exists():
            try:
                frames = json.loads(cached.read_text())
            except Exception:
                frames = None
        if frames is None:
            frames = _detect_chunk(src, t0, CHUNK_S, (WIDTH, h))
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(json.dumps(frames))
        for i, faces in enumerate(frames):
            t = t0 + i / FPS
            if start - 1 <= t <= end + 1:
                out.append((round(t, 3), [tuple(f) for f in faces]))  # type: ignore[misc]
        if len(frames) < CHUNK_S * FPS - 1:  # final del vídeo
            break
        k += 1
    return out


def _inside(f: Face, zone: dict | None) -> bool:
    if not zone:
        return True
    return zone["x"] <= f[0] <= zone["x"] + zone["w"] and zone["y"] <= f[1] <= zone["y"] + zone["h"]


def build_track(dets: list[tuple[float, list[Face]]], zone: dict | None = None, deadzone: float = 0.03,
                step: float = 0.5) -> list[dict]:
    """Trayectoria suave (t, x, y) del centro de la cara a seguir. Vacía si casi no hay caras."""
    picks: list[tuple[float, float, float] | None] = []
    prev: Face | None = None
    for t, faces in dets:
        cand = [f for f in faces if _inside(f, zone)]
        if not cand:
            picks.append(None)
            continue
        big = max(f[2] for f in cand)
        cand = [f for f in cand if f[2] >= big * 0.5]  # ignora caras pequeñas del fondo
        if prev is not None:
            f = min(cand, key=lambda g: (g[0] - prev[0]) ** 2 + (g[1] - prev[1]) ** 2)
            # un salto muy grande en un solo frame suele ser un falso positivo
            if (f[0] - prev[0]) ** 2 + (f[1] - prev[1]) ** 2 > 0.35 ** 2 and len(cand) == 1:
                picks.append(None)
                continue
        else:
            f = max(cand, key=lambda g: g[2])
        prev = f
        picks.append((t, f[0], f[1]))
    found = [p for p in picks if p]
    if len(found) < max(2, 0.15 * len(dets)):
        return []
    # Rellena huecos: mantiene la última posición (o la primera conocida al principio)
    xs, ys, ts = [], [], []
    last = found[0]
    for (t, _), p in zip(dets, picks):
        last = p or last
        ts.append(t)
        xs.append(last[1])
        ys.append(last[2])
    # Mediana móvil (quita parpadeos) → zona muerta (no tiembla con movimientos pequeños) →
    # suavizado exponencial hacia delante y hacia atrás (sin retraso: el vídeo ya está grabado).
    def med(v: list[float], r: int = 2) -> list[float]:
        return [float(np.median(v[max(0, i - r):i + r + 1])) for i in range(len(v))]

    def hold(v: list[float]) -> list[float]:
        out_, cur = [], v[0]
        for x in v:
            if abs(x - cur) > deadzone:
                cur = x
            out_.append(cur)
        return out_

    def smooth(v: list[float], a: float = 0.3) -> list[float]:
        f = list(v)
        for i in range(1, len(f)):
            f[i] = f[i - 1] + (f[i] - f[i - 1]) * a
        for i in range(len(f) - 2, -1, -1):
            f[i] = f[i + 1] + (f[i] - f[i + 1]) * a
        return f

    xs, ys = smooth(hold(med(xs))), smooth(hold(med(ys)))
    out: list[dict] = []
    next_t = ts[0]
    for i, t in enumerate(ts):
        if t >= next_t or i == len(ts) - 1:
            out.append({"t": round(t, 2), "x": round(xs[i], 4), "y": round(ys[i], 4)})
            next_t = t + step
    return out


def lerp_track(track: list[dict], t: float) -> tuple[float, float] | None:
    if not track:
        return None
    if t <= track[0]["t"]:
        return track[0]["x"], track[0]["y"]
    for a, b in zip(track, track[1:]):
        if a["t"] <= t <= b["t"]:
            k = (t - a["t"]) / max(1e-6, b["t"] - a["t"])
            return a["x"] + (b["x"] - a["x"]) * k, a["y"] + (b["y"] - a["y"]) * k
    return track[-1]["x"], track[-1]["y"]


def webcam_from_detections(dets: list[tuple[float, list[Face]]]) -> dict | None:
    """Zona de una webcam superpuesta (cara pequeña siempre en el mismo sitio), o None."""
    from app.analysis.visual import estimate_webcam
    faces = [(t, cx - w / 2, cy - h / 2, w, h) for t, fs in dets for (cx, cy, w, h) in fs]
    return estimate_webcam(faces, len(dets))
