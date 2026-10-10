"""IA de voz gratuita (faster-whisper): detecta risas/frases y crea subtítulos."""

from __future__ import annotations

import os
import re
import subprocess
from typing import Optional

import numpy as np

from .medios import ffmpeg_bin

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
    # Pasamos el audio ya decodificado (numpy) para no depender de la versión de PyAV.
    crudo = subprocess.run(
        [ffmpeg_bin(), "-hide_banner", "-nostdin", "-ss", f"{inicio:.3f}", "-i", audio,
         "-t", f"{fin - inicio:.3f}", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout
    muestras = np.frombuffer(crudo, dtype=np.int16).astype(np.float32) / 32768.0
    segmentos, _ = _cargar().transcribe(muestras, word_timestamps=True, vad_filter=False)
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

# Despedidas, saludos y peticiones de suscripción: no sirven como clip para redes.
RELLENO = re.compile(
    r"\b(?:suscr[ií]b\w*|dale (?:a )?like|deja(?:d)? (?:tu|un) like|campanita|nos vemos|"
    r"hasta (?:la pr[oó]xima|luego)|gracias por (?:ver|estar)|bienvenid\w*|hola a todos|"
    r"en el (?:pr[oó]ximo|siguiente) v[ií]deo|link en la descripci[oó]n|subscribe|see you)\b", re.I)


def bonus_gracia(trozos: list[Trozo]) -> tuple[float, Optional[str]]:
    """Puntos extra si en el clip hay risas o reacciones habladas."""
    texto = " ".join(t for _, _, t in trozos)
    risas = len(RISAS.findall(texto))
    exclamaciones = texto.count("!") + texto.count("¡")
    expresiones = len(EXPRESIONES.findall(texto))
    bonus = 0.7 * min(risas, 4) + 0.12 * min(exclamaciones, 6) + 0.35 * min(expresiones, 3)
    if not texto.strip():
        bonus -= 0.3
    bonus -= 1.2 * min(len(RELLENO.findall(texto)), 2)
    motivo = "🤣 Risas en el audio" if risas else ("🗣️ Reacción hablada" if expresiones else None)
    return bonus, motivo
