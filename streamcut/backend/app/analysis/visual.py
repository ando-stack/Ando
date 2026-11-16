"""Análisis visual con muestreo eficiente.

- Se decodifica el proxy a baja resolución y pocos fps (por defecto 2 fps, 160 px) con FFmpeg.
- Movimiento: diferencia media entre fotogramas consecutivos.
- Cortes de escena: PySceneDetect (ContentDetector) sobre el proxy.
- Caras: Haar cascade de OpenCV a 0.5 fps; si una cara aparece de forma estable en la misma
  esquina se propone como región de webcam (para el reencuadre/split screen).
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.media.ffmpeg import ffmpeg_bin

log = logging.getLogger(__name__)


@dataclass
class VisualFeatures:
    hop: float
    motion: np.ndarray
    scene_cuts: list[float] = field(default_factory=list)
    faces: list[tuple[float, float, float, float, float]] = field(default_factory=list)  # t,x,y,w,h (0..1)
    webcam_region: dict | None = None
    face_ratio: float = 0.0


def _frames(path: Path, fps: float, width: int, height: int):
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-v", "error", "-i", str(path), "-an", "-sn",
           "-vf", f"fps={fps},scale={width}:{height}", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = width * height
    assert proc.stdout is not None
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(height, width)
    finally:
        proc.stdout.close()
        proc.wait()


def detect_scenes(path: Path) -> list[float]:
    try:
        from scenedetect import ContentDetector, detect
        scenes = detect(str(path), ContentDetector(threshold=27.0), show_progress=False)
        return [float(s[0].seconds if hasattr(s[0], 'seconds') else s[0].get_seconds()) for s in scenes[1:]]
    except Exception as exc:  # PySceneDetect no disponible o vídeo raro: no bloquea el análisis
        log.warning("Detección de escenas no disponible: %s", exc)
        return []


def analyze(path: Path, duration: float, src_w: int | None, src_h: int | None, hop: float,
            fps: float = 2.0, cancel=None) -> VisualFeatures:
    n = max(1, int(duration / hop) + 1)
    motion = np.zeros(n, dtype=np.float32)
    w = 160
    h = max(2, int(round((src_h or 9) / (src_w or 16) * w / 2)) * 2)
    prev = None
    faces: list[tuple[float, float, float, float, float]] = []
    cascade = None
    try:
        import cv2
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        if cascade.empty():
            cascade = None
    except Exception:
        cascade = None
    # Para caras usamos más resolución (320 px) a 0.5 fps
    for i, frame in enumerate(_frames(path, fps, w, h)):
        t = i / fps
        if prev is not None:
            idx = min(n - 1, int(t / hop))
            motion[idx] = max(motion[idx], float(np.mean(np.abs(frame.astype(np.int16) - prev))) / 255.0)
        prev = frame.astype(np.int16)
        if cancel and i % 50 == 0 and cancel():
            break
    if cascade is not None:
        fw, fh = 320, h * 2
        for i, frame in enumerate(_frames(path, 0.5, fw, fh)):
            found = cascade.detectMultiScale(frame, scaleFactor=1.15, minNeighbors=5, minSize=(16, 16))
            for (x, y, fw_, fh_) in found:
                faces.append((i / 0.5, x / fw, y / fh, fw_ / fw, fh_ / fh))
    # Rellena huecos de movimiento (muestreo a fps < 1/hop)
    if fps < 1 / hop:
        step = int(round(1 / (fps * hop)))
        for i in range(n):
            if motion[i] == 0 and i - i % step < n:
                motion[i] = motion[i - i % step]
    feats = VisualFeatures(hop=hop, motion=motion, scene_cuts=detect_scenes(path), faces=faces)
    samples = max(1, int(duration * 0.5))
    feats.face_ratio = len({int(f[0]) for f in faces}) / samples
    feats.webcam_region = estimate_webcam(faces, samples)
    return feats


def estimate_webcam(faces: list[tuple[float, float, float, float, float]], samples: int) -> dict | None:
    """Si una cara pequeña aparece en la misma zona en ≥ 40 % de las muestras, es una webcam superpuesta."""
    if not faces or samples == 0:
        return None
    small = [f for f in faces if f[3] < 0.3]
    if len(small) < max(3, 0.4 * samples):
        return None
    cx = np.median([f[1] + f[3] / 2 for f in small])
    cy = np.median([f[2] + f[4] / 2 for f in small])
    near = [f for f in small if abs(f[1] + f[3] / 2 - cx) < 0.08 and abs(f[2] + f[4] / 2 - cy) < 0.08]
    if len(near) < max(3, 0.4 * samples):
        return None
    fw = float(np.median([f[3] for f in near]))
    fh = float(np.median([f[4] for f in near]))
    # La webcam suele ser ~3x el tamaño de la cara
    w, h = min(0.5, fw * 3.2), min(0.5, fh * 3.2)
    x = float(np.clip(cx - w / 2, 0, 1 - w))
    y = float(np.clip(cy - h / 2, 0, 1 - h))
    return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4),
            "confidence": round(min(1.0, len(near) / samples), 3)}


def visual_series(v: VisualFeatures, n: int) -> np.ndarray:
    """Impacto visual 0..1: movimiento relativo + cortes de escena."""
    m = v.motion[:n] if len(v.motion) >= n else np.pad(v.motion, (0, n - len(v.motion)))
    med = float(np.median(m)) if m.size else 0.0
    mad = float(np.median(np.abs(m - med)) * 1.4826) or 0.01
    z = np.clip((m - med) / mad, 0, 6) / 6
    for t in v.scene_cuts:
        i = int(t / v.hop)
        if 0 <= i < n:
            z[i] = max(z[i], 0.6)
    return z.astype(np.float32)
