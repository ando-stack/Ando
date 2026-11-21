"""Optional speech-to-text for the communication analyzer.

Uses faster-whisper locally when installed and WHISPER_MODEL is set
(pip install faster-whisper). Without it, the communication module is
reported as "not assessable" instead of being guessed.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings


def available() -> tuple[bool, str]:
    s = get_settings()
    if not s.whisper_model:
        return False, "Transcripción desactivada (configura WHISPER_MODEL e instala faster-whisper)."
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False, "faster-whisper no está instalado en el backend."
    return True, f"faster-whisper ({s.whisper_model})"


def transcribe(wav: Path) -> list[dict]:
    from faster_whisper import WhisperModel

    model = WhisperModel(get_settings().whisper_model, device="auto", compute_type="int8")
    segments, _info = model.transcribe(str(wav), vad_filter=True, language=None)
    out = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            out.append({"t": round(seg.start, 2), "t_end": round(seg.end, 2), "text": text})
    return out
