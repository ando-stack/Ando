"""IA de voz gratuita (faster-whisper): detecta risas/frases y crea subtítulos."""

from __future__ import annotations

import os
import re
import tempfile
from typing import Optional

from .medios import ffmpeg

Trozo = tuple[float, float, str]

MODELO = os.environ.get("AUTOCLIPS_MODELO", "base")
_modelo = None


def disponible() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


def _cargar():
    global _modelo
    if _modelo is None:
        from faster_whisper import WhisperModel

        try:  # con tarjeta gráfica (p. ej. Google Colab) va mucho más rápido
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                _modelo = WhisperModel(os.environ.get("AUTOCLIPS_MODELO", "small"),
                                       device="cuda", compute_type="float16")
        except Exception:
            _modelo = None
        if _modelo is None:
            _modelo = WhisperModel(MODELO, device="cpu", compute_type="int8")
    return _modelo


def transcribir(audio: str, inicio: float, fin: float) -> list[Trozo]:
    """Transcribe [inicio, fin] del audio y lo agrupa en frases cortas estilo TikTok.

    Los tiempos devueltos son relativos al inicio del clip.
    """
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "trozo.wav")
        ffmpeg(["-ss", f"{inicio:.3f}", "-i", audio, "-t", f"{fin - inicio:.3f}",
                "-vn", "-ac", "1", "-ar", "16000", wav])
        segmentos, _ = _cargar().transcribe(wav, word_timestamps=True, vad_filter=False)
        trozos: list[Trozo] = []
        grupo: list = []
        for seg in segmentos:
            for p in seg.words or []:
                grupo.append(p)
                texto = "".join(x.word for x in grupo).strip()
                if len(grupo) >= 4 or len(texto) > 22 or p.word.strip().endswith((".", "?", "!", ",")):
                    trozos.append((grupo[0].start, grupo[-1].end, texto))
                    grupo = []
        if grupo:
            trozos.append((grupo[0].start, grupo[-1].end, "".join(x.word for x in grupo).strip()))
    return trozos


RISAS = re.compile(r"(?:ja){2,}|(?:je){2,}|(?:ha){2,}|(?:jsjs)|\b(?:risas?|laugh\w*|lol|xd)\b", re.I)
EXPRESIONES = re.compile(
    r"\b(?:no puede ser|qu[eé] (?:dices|haces|ha pasado)|madre m[ií]a|dios m[ií]o|"
    r"joder|hostia|la madre|wtf|oh my god|nooo+)\b", re.I)


def bonus_gracia(trozos: list[Trozo]) -> tuple[float, Optional[str]]:
    """Puntos extra si en el clip hay risas o reacciones habladas."""
    texto = " ".join(t for _, _, t in trozos)
    risas = len(RISAS.findall(texto))
    exclamaciones = texto.count("!") + texto.count("¡")
    expresiones = len(EXPRESIONES.findall(texto))
    bonus = 0.7 * min(risas, 4) + 0.12 * min(exclamaciones, 6) + 0.35 * min(expresiones, 3)
    if not texto.strip():
        bonus -= 0.3
    motivo = "🤣 Risas en el audio" if risas else ("🗣️ Reacción hablada" if expresiones else None)
    return bonus, motivo
