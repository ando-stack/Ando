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


def _escuchar(audio: str, inicio: float, fin: float) -> tuple[list[Trozo], list[Trozo]]:
    """Frases y palabras de [inicio, fin], con tiempos absolutos (segundos del vídeo)."""
    inicio = max(0.0, inicio)
    # Pasamos el audio ya decodificado (numpy) para no depender de la versión de PyAV.
    crudo = subprocess.run(
        [ffmpeg_bin(), "-hide_banner", "-nostdin", "-ss", f"{inicio:.3f}", "-i", audio,
         "-t", f"{fin - inicio:.3f}", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout
    muestras = np.frombuffer(crudo, dtype=np.int16).astype(np.float32) / 32768.0
    segmentos, _ = _cargar().transcribe(muestras, word_timestamps=True, vad_filter=False)
    frases: list[Trozo] = []
    palabras: list[Trozo] = []
    for seg in segmentos:
        frases.append((inicio + float(seg.start), inicio + float(seg.end), seg.text.strip()))
        for p in seg.words or []:
            palabras.append((inicio + float(p.start), inicio + float(p.end), p.word))
    return frases, palabras


def _agrupar(palabras: list[Trozo], inicio: float, fin: float) -> list[Trozo]:
    """Agrupa en trozos cortos (3-4 palabras) estilo TikTok, relativos a `inicio`."""
    trozos: list[Trozo] = []
    grupo: list[Trozo] = []
    for p in palabras:
        if p[1] <= inicio or p[0] >= fin:
            continue
        grupo.append(p)
        texto = "".join(x[2] for x in grupo).strip()
        if len(grupo) >= 4 or len(texto) > 22 or p[2].strip().endswith((".", "?", "!", ",")):
            trozos.append((max(0.0, grupo[0][0] - inicio), grupo[-1][1] - inicio, texto))
            grupo = []
    if grupo:
        trozos.append((max(0.0, grupo[0][0] - inicio), grupo[-1][1] - inicio,
                       "".join(x[2] for x in grupo).strip()))
    return trozos


def transcribir(audio: str, inicio: float, fin: float) -> list[Trozo]:
    """Transcribe [inicio, fin] en trozos estilo TikTok (tiempos relativos al clip)."""
    _, palabras = _escuchar(audio, inicio, fin)
    return _agrupar(palabras, inicio, fin)


def ajustar_a_frases(audio: str, inicio: float, fin: float, total: float,
                     largo_max: float = 60.0) -> tuple[float, float, list[Trozo]]:
    """Mueve el inicio al principio de una frase y el final al final de una frase.

    Así el clip no empieza ni acaba a mitad de frase (el final puede alargarse hasta
    `largo_max` segundos para acabar la frase). Devuelve (inicio, fin, subtítulos).
    """
    atras, delante = 15.0, max(4.0, min(25.0, largo_max - (fin - inicio)))
    _, palabras = _escuchar(audio, inicio - atras, min(total, fin + delante))
    if not palabras:
        return inicio, fin, []
    # Fronteras de frase: después de . ? ! (y el principio del trozo escuchado).
    inicios = {palabras[0][0]} if inicio - atras <= 0 else set()
    finales: set[float] = set()
    suaves_ini: set[float] = set()
    suaves_fin: set[float] = set()
    for ant, sig in zip(palabras, palabras[1:]):
        if ant[2].strip().endswith((".", "?", "!", "…")):
            finales.add(ant[1])
            inicios.add(sig[0])
        elif ant[2].strip().endswith((",", ";", ":")) or sig[0] - ant[1] >= 0.45:
            suaves_fin.add(ant[1])
            suaves_ini.add(sig[0])
    if palabras[-1][2].strip().endswith((".", "?", "!", "…")):
        finales.add(palabras[-1][1])

    def mas_cerca(opciones: set[float], t: float, desde: float, hasta: float) -> Optional[float]:
        validas = [x for x in opciones if desde <= x <= hasta]
        return min(validas, key=lambda x: abs(x - t)) if validas else None

    nuevo_ini = (mas_cerca(inicios, inicio, inicio - atras, inicio + 4)
                 or mas_cerca(suaves_ini, inicio, inicio - 6, inicio + 3) or inicio)
    nuevo_fin = (mas_cerca(finales, fin, fin - 3, min(fin + delante, nuevo_ini + largo_max))
                 or mas_cerca(suaves_fin, fin, fin - 3, fin + 8) or fin)
    # Un pequeño margen, sin llegar a oír la palabra anterior ni la siguiente.
    previa = max((p[1] for p in palabras if p[0] < nuevo_ini - 0.01), default=None)
    siguiente = min((p[0] for p in palabras if p[0] > nuevo_fin), default=None)
    nuevo_ini = max(0.0, nuevo_ini - 0.15, (previa + 0.02) if previa is not None else 0.0)
    nuevo_fin = min(total, nuevo_fin + 0.35, (siguiente - 0.03) if siguiente is not None else total)
    if nuevo_fin - nuevo_ini < 3:
        nuevo_ini, nuevo_fin = inicio, fin
    return nuevo_ini, nuevo_fin, _agrupar(palabras, nuevo_ini, nuevo_fin)


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
