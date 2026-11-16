"""Transcripción con faster-whisper (CPU int8 o GPU CUDA float16).

- Detección automática de idioma.
- Timestamps por palabra.
- Confianza por segmento = exp(avg_logprob).
- Audio largo: se procesa por bloques de 10 min (memoria acotada, progreso y cancelación).
"""

from __future__ import annotations

import logging
import math
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.core.config import get_settings
from app.media.ffmpeg import Cancelled, read_pcm

log = logging.getLogger(__name__)

CHUNK_SECONDS = 600.0
_models: dict[tuple[str, str], object] = {}
_lock = threading.Lock()


@dataclass
class Word:
    start: float
    end: float
    text: str
    prob: float


@dataclass
class Segment:
    start: float
    end: float
    text: str
    confidence: float
    words: list[Word] = field(default_factory=list)


@dataclass
class Transcript:
    language: str | None
    language_probability: float | None
    segments: list[Segment]

    @property
    def words(self) -> list[Word]:
        return [w for s in self.segments for w in s.words]


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:  # pragma: no cover
        return False


def device() -> tuple[str, str]:
    pref = get_settings().whisper_device
    if pref in ("auto", "cuda"):
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                return "cuda", "float16"
        except Exception:
            pass
    return "cpu", "int8"


def get_model(name: str | None = None):
    from faster_whisper import WhisperModel

    name = name or get_settings().whisper_model
    dev, ctype = device()
    key = (name, dev)
    with _lock:
        if key not in _models:
            log.info("Cargando modelo Whisper '%s' en %s (%s)", name, dev, ctype)
            _models[key] = WhisperModel(name, device=dev, compute_type=ctype)
        return _models[key]


def transcribe_samples(samples: np.ndarray, offset: float = 0.0, model_name: str | None = None,
                       language: str | None = None) -> Transcript:
    model = get_model(model_name)
    segs, info = model.transcribe(samples, word_timestamps=True, vad_filter=True, language=language,
                                  condition_on_previous_text=False, beam_size=1)
    out: list[Segment] = []
    for s in segs:
        words = [Word(offset + float(w.start), offset + float(w.end), w.word, float(w.probability))
                 for w in (s.words or [])]
        text = s.text.strip()
        if not text:
            continue
        out.append(Segment(offset + float(s.start), offset + float(s.end), text,
                           float(math.exp(min(0.0, s.avg_logprob))), words))
    return Transcript(info.language, float(info.language_probability), out)


def transcribe_file(wav: Path, duration: float, *, model_name: str | None = None,
                    progress: Callable[[float], None] | None = None,
                    cancel: Callable[[], bool] | None = None) -> Transcript:
    segments: list[Segment] = []
    language: str | None = None
    lang_p: float | None = None
    t = 0.0
    while t < duration:
        if cancel and cancel():
            raise Cancelled("Cancelado")
        length = min(CHUNK_SECONDS, duration - t)
        samples = read_pcm(wav, t, length)
        if samples.size:
            part = transcribe_samples(samples, offset=t, model_name=model_name, language=language)
            if language is None:
                language, lang_p = part.language, part.language_probability
            # Evita duplicar un segmento que cruza el límite del bloque
            for s in part.segments:
                if segments and s.start < segments[-1].end - 0.05:
                    continue
                segments.append(s)
        t += length
        if progress:
            progress(min(1.0, t / max(duration, 1e-6)))
    return Transcript(language, lang_p, segments)
