"""Transcripción local con faster-whisper (timestamps por palabra)."""
from __future__ import annotations

import json
import threading
import wave
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from config import WHISPER_COMPUTE, WHISPER_DEVICE, WHISPER_MODEL

_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
        return _model


def load_wav(path: Path) -> np.ndarray:
    """Lee el WAV mono 16 kHz generado por ingest (evita depender de PyAV para decodificar)."""
    with wave.open(str(path), "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError("se esperaba WAV mono 16 kHz de 16 bits")
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(audio_path: Path, language: Optional[str] = "es", duration: Optional[float] = None,
               progress: Optional[Callable[[float], None]] = None, cache: Optional[Path] = None) -> list[dict]:
    """Devuelve una lista de palabras [{text, start, end, prob}] en tiempo del archivo."""
    if cache and cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    model = get_model()
    segments, info = model.transcribe(
        load_wav(audio_path), language=language or None, word_timestamps=True,
        vad_filter=False, condition_on_previous_text=False, beam_size=5,
        # Sin esto Whisper tiende a "limpiar" las muletillas, y queremos detectarlas
        initial_prompt="Eh, bueno, pues... em, o sea, vale. Hola, ¿qué tal?",
    )
    words: list[dict] = []
    total = duration or getattr(info, "duration", None) or 1
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            words.append({"text": text, "start": round(float(w.start), 3),
                          "end": round(float(w.end), 3), "prob": round(float(w.probability), 3)})
        if progress:
            progress(min(1.0, seg.end / total))
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    return words


def words_to_text(words: list[dict]) -> str:
    return " ".join(w["text"] for w in words).strip()
