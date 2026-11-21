"""HUD reader without generative AI.

* OCR: RapidOCR (ONNX, models shipped inside the pip wheel, CPU) — recognition
  only, on the calibrated crops, batched per frame.
* Colour: storm overlay detection (Fortnite tints the screen purple inside the
  storm) measured on the frame border.

Every value carries a confidence; implausible values (out of range, wrong
format) are discarded instead of guessed.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import numpy as np

from ..config import get_settings
from .layout import FIELDS

_ocr = None


def ocr_available() -> tuple[bool, str]:
    try:
        import rapidocr_onnxruntime  # noqa: F401
    except ImportError:
        return False, "Falta el paquete rapidocr-onnxruntime (pip install -r requirements.txt)."
    return True, "RapidOCR (ONNX, CPU)"


def _engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR

        _ocr = RapidOCR()
    return _ocr


@dataclass
class HudSample:
    t: float
    values: dict = field(default_factory=dict)  # field -> int | seconds
    conf: dict = field(default_factory=dict)  # field -> 0..1
    raw: dict = field(default_factory=dict)  # field -> OCR text
    storm: float = 0.0  # fraction of border pixels with storm tint
    brightness: float = 0.0


def _prep(crop: np.ndarray) -> np.ndarray:
    """Upscale small HUD digits and pad: the recogniser expects ~48 px text height."""
    h, w = crop.shape[:2]
    scale = max(1.0, 48.0 / max(1, h))
    if scale > 1.0:
        from PIL import Image

        crop = np.array(Image.fromarray(crop).resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BICUBIC))
    pad = 8
    return np.pad(crop, ((pad, pad), (pad, pad), (0, 0)), mode="edge")


_DIGITS = str.maketrans({"O": "0", "o": "0", "。": "0", "°": "0", "D": "0", "Q": "0", "l": "1", "I": "1", "|": "1", "!": "1",
                         "S": "5", "s": "5", "B": "8", "Z": "2", "z": "2", "G": "6", "g": "9", "q": "9", "，": "", ",": "", ".": "", " ": ""})


def parse_value(field_name: str, text: str) -> int | None:
    spec = FIELDS[field_name]
    t = text.strip().translate(_DIGITS)
    if spec["kind"] == "time":
        m = re.search(r"(\d{1,2})[:;.](\d{2})", text.strip())
        if not m or int(m.group(2)) >= 60:
            return None
        return int(m.group(1)) * 60 + int(m.group(2))
    digits = re.findall(r"\d+", t)
    if len(digits) != 1:
        return None
    v = int(digits[0])
    if v < 0 or (spec["max"] is not None and v > spec["max"]):
        return None
    return v


def storm_fraction(frame: np.ndarray) -> float:
    """Share of border pixels with the storm's purple/magenta tint (HSV)."""
    h, w = frame.shape[:2]
    b = max(4, int(min(h, w) * 0.12))
    border = np.concatenate([frame[:b].reshape(-1, 3), frame[-b:].reshape(-1, 3), frame[:, :b].reshape(-1, 3), frame[:, -b:].reshape(-1, 3)])
    rgb = border.astype(np.float32) / 255.0
    mx, mn = rgb.max(axis=1), rgb.min(axis=1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, bl = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    # purple/magenta: blue and red both clearly above green
    purple = (bl > g + 0.08) & (r > g + 0.04) & (sat > 0.3) & (mx > 0.18)
    return float(purple.mean())


class HudReader:
    def __init__(self, layout: dict):
        self.layout = layout
        self.calibrated = bool(layout.get("calibrated"))
        self.fields = [k for k in FIELDS if k in layout.get("rects", {})]

    def crops(self, frame: np.ndarray) -> dict[str, np.ndarray]:
        h, w = frame.shape[:2]
        out = {}
        for k in self.fields:
            x0, y0, x1, y1 = self.layout["rects"][k]
            c = frame[int(y0 * h): max(int(y0 * h) + 2, int(y1 * h)), int(x0 * w): max(int(x0 * w) + 2, int(x1 * w))]
            if c.size:
                out[k] = c
        return out

    def read(self, frame: np.ndarray, t: float = 0.0) -> HudSample:
        s = HudSample(t=t, storm=storm_fraction(frame), brightness=float(frame.mean()))
        crops = self.crops(frame)
        if not crops:
            return s
        names = list(crops)
        # RapidOCR expects BGR
        batch = [np.ascontiguousarray(_prep(crops[n])[:, :, ::-1]) for n in names]
        res, _ = _engine().text_recognizer(batch)
        base = 0.9 if self.calibrated else 0.5
        for n, (text, score) in zip(names, res):
            s.raw[n] = text
            v = parse_value(n, text)
            # a lone "0" is often recognised as "。"/"o" with a low score: accept it, with less confidence
            lone_zero = v is not None and v < 10 and len(text.strip()) == 1  # single digits score low
            if v is not None and (float(score) >= 0.45 or (lone_zero and float(score) >= 0.15)):
                s.values[n] = v
                s.conf[n] = round(base * (0.7 if lone_zero else min(1.0, float(score) + 0.15)), 2)
        return s


def iter_frames(src: Path, every: float, width: int = 1280) -> Iterator[tuple[float, np.ndarray]]:
    """Decode the video once at 1/every fps (fast; no per-frame seeking)."""
    from ..video.ffmpeg import probe

    s = get_settings()

    info = probe(src)
    height = int(round(info.height * width / max(1, info.width) / 2) * 2) if info.width else 720
    proc = subprocess.Popen(
        [s.ffmpeg, "-v", "error", "-i", str(src), "-vf", f"fps=1/{every},scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    assert proc.stdout
    size = width * height * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield (round(i * every, 3), np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3))
            i += 1
    finally:
        proc.kill()
        proc.wait()
