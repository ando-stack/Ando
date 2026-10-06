"""Busca los momentos destacados: puntúa cada medio segundo y elige los mejores."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .chat import RETRASO_CHAT, Chat, clasificar
from .medios import Progreso, ffmpeg_bin, sin_progreso

PASO = 0.5  # segundos por muestra

ESTILOS = {
    "todo": "Todo lo destacado",
    "graciosos": "Graciosos (risas)",
    "epicos": "Épicos (hype, gritos, jugadas)",
}

# Peso de cada señal según lo que busca el usuario.
PESOS = {
    "todo":      {"voz": 1.0, "chat": 1.0, "risa_chat": 1.1, "hype_chat": 1.0, "escenas": 0.35},
    "graciosos": {"voz": 0.7, "chat": 0.7, "risa_chat": 1.8, "hype_chat": 0.4, "escenas": 0.2},
    "epicos":    {"voz": 1.3, "chat": 1.0, "risa_chat": 0.5, "hype_chat": 1.6, "escenas": 0.5},
}


# ---------------------------------------------------------------------------
# Señales
# ---------------------------------------------------------------------------

def energia_audio(ruta: str, duracion: float, progreso: Progreso = sin_progreso) -> np.ndarray:
    """Volumen (dB) cada PASO segundos, leído en streaming para no gastar RAM."""
    sr = 8000
    ventana = int(sr * PASO)
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", ruta, "-vn", "-ac", "1",
           "-ar", str(sr), "-f", "s16le", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    resto = b""
    niveles: list[np.ndarray] = []
    leidos = 0
    while True:
        datos = proc.stdout.read(ventana * 2 * 240)
        if not datos:
            break
        datos = resto + datos
        util = len(datos) - len(datos) % (ventana * 2)
        resto = datos[util:]
        if util:
            x = np.frombuffer(datos[:util], dtype=np.int16).astype(np.float32) / 32768.0
            x = x.reshape(-1, ventana)
            niveles.append(20 * np.log10(np.sqrt(np.mean(x * x, axis=1) + 1e-10)))
            leidos += x.shape[0]
            if duracion > 0:
                progreso(min(99.0, leidos * PASO * 100 / duracion), "Escuchando el audio…")
    proc.wait()
    if not niveles:
        return np.full(max(1, int(duracion / PASO)), -60.0, dtype=np.float32)
    return np.concatenate(niveles)


def cambios_de_escena(ruta: str, n: int, duracion: float,
                      progreso: Progreso = sin_progreso) -> np.ndarray:
    """Cortes de cámara por muestra (vídeo reducido para ir rápido)."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", ruta, "-an", "-sn",
           "-vf", "fps=3,scale=96:-2,select='gte(scene,0)',"
                  "metadata=mode=print:key=lavfi.scene_score:file=-",
           "-nostats", "-f", "null", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                            errors="replace")
    assert proc.stdout is not None
    cortes = np.zeros(n, dtype=np.float32)
    instante = aviso = 0.0
    for linea in proc.stdout:
        m = re.search(r"pts_time:([\d.]+)", linea)
        if m:
            instante = float(m.group(1))
            if duracion > 0 and instante - aviso >= 5:
                aviso = instante
                progreso(min(99.0, instante * 100 / duracion), "Detectando cortes de cámara…")
        elif linea.startswith("lavfi.scene_score="):
            try:
                valor = float(linea.split("=", 1)[1])
            except ValueError:
                continue
            i = int(instante / PASO)
            if valor > 0.3 and 0 <= i < n:
                cortes[i] += 1
    proc.wait()
    return cortes


def suavizar(x: np.ndarray, segundos: float) -> np.ndarray:
    k = max(1, min(len(x), int(segundos / PASO)))
    if k <= 1:
        return x.astype(np.float32)
    return np.convolve(x, np.ones(k, dtype=np.float32) / k, mode="same")


def z(x: np.ndarray) -> np.ndarray:
    """Normalización robusta (mediana / MAD) recortada a [-3, 4]."""
    med = np.median(x)
    mad = np.median(np.abs(x - med)) * 1.4826
    if mad < 1e-6:
        mad = float(np.std(x)) or 1.0
    return np.clip((x - med) / mad, -3, 4)


def _mapa_de_calor(info: Optional[dict], n: int) -> Optional[np.ndarray]:
    calor = (info or {}).get("heatmap")
    if not calor:
        return None
    curva = np.zeros(n, dtype=np.float32)
    for tramo in calor:
        a = int(float(tramo.get("start_time", 0)) / PASO)
        b = int(float(tramo.get("end_time", 0)) / PASO)
        curva[max(0, a):min(n, max(a + 1, b))] = float(tramo.get("value", 0))
    return curva if curva.any() else None


def series_chat(chat: Chat, n: int) -> dict[str, np.ndarray]:
    """Mensajes por muestra, adelantados RETRASO_CHAT para alinearlos con lo que pasó."""
    total = np.zeros(n, dtype=np.float32)
    risa = np.zeros(n, dtype=np.float32)
    hype = np.zeros(n, dtype=np.float32)
    for t, texto in chat.mensajes:
        i = int((t - RETRASO_CHAT) / PASO)
        if 0 <= i < n:
            total[i] += 1
            es_risa, es_hype = clasificar(texto)
            risa[i] += es_risa
            hype[i] += es_hype
    return {"total": total, "risa": risa, "hype": hype}


@dataclass
class Analisis:
    puntos: np.ndarray
    volumen: np.ndarray
    componentes: dict[str, np.ndarray] = field(default_factory=dict)
    senales: list[str] = field(default_factory=list)


def puntuar(volumen: np.ndarray, info: Optional[dict] = None, chat: Optional[Chat] = None,
            cortes: Optional[np.ndarray] = None, estilo: str = "todo") -> Analisis:
    """Combina todas las señales en una puntuación de interés por muestra."""
    n = len(volumen)
    pesos = PESOS.get(estilo, PESOS["todo"])
    comp: dict[str, np.ndarray] = {}
    senales = ["volumen y gritos"]

    vol = suavizar(volumen, 2.0)
    subidon = vol - suavizar(volumen, 45.0)  # gritos/risas respecto a lo que había antes
    comp["voz"] = pesos["voz"] * (0.45 * z(vol) + 0.8 * z(subidon))

    if chat:
        s = series_chat(chat, n)
        base = suavizar(s["total"], 300.0) + 0.05
        ritmo = np.log1p(suavizar(s["total"], 8.0) / base)  # actividad relativa al momento del stream
        comp["chat"] = pesos["chat"] * 1.3 * z(ritmo)
        if s["risa"].sum() >= 5:
            comp["risa_chat"] = pesos["risa_chat"] * 1.4 * z(suavizar(s["risa"], 8.0) / np.sqrt(base))
        if s["hype"].sum() >= 5:
            comp["hype_chat"] = pesos["hype_chat"] * 1.0 * z(suavizar(s["hype"], 8.0) / np.sqrt(base))
        senales.append(chat.origen)

    if cortes is not None and cortes.any():
        comp["escenas"] = pesos["escenas"] * z(suavizar(cortes, 6.0))
        senales.append("cortes de cámara")

    calor = _mapa_de_calor(info, n)
    if calor is not None:
        comp["calor"] = 1.6 * z(calor)
        senales.append("lo más visto de YouTube")

    puntos = sum(comp.values())
    silencio = volumen < (np.median(volumen) - 20)
    puntos = puntos - 1.5 * suavizar(silencio.astype(np.float32), 3.0)
    return Analisis(puntos=suavizar(puntos, 1.5), volumen=volumen, componentes=comp, senales=senales)


# ---------------------------------------------------------------------------
# Elección de momentos
# ---------------------------------------------------------------------------

@dataclass
class Momento:
    inicio: float
    fin: float
    pico: float
    valor: float
    motivo: str = ""
    nota: int = 0
    transcripcion: Optional[list] = None  # [(ini, fin, texto)] relativo al clip


def elegir_momentos(an: Analisis, cantidad: int, dur_min: float, dur_max: float,
                    total: float) -> list[Momento]:
    """Busca picos de interés y construye un clip alrededor de cada uno.

    El clip arranca un poco antes (para que se entienda el contexto) y acaba cuando
    pasa la reacción, ajustando los cortes a pausas para no partir frases.
    """
    s = an.puntos
    n = len(s)
    if total <= dur_min + 1 or n < 4:
        return [Momento(0.0, total, 0.0, 1.0)]

    mediana = float(np.median(s))
    libre = np.ones(n, dtype=bool)
    ocupado: list[tuple[float, float]] = []
    momentos: list[Momento] = []
    hueco = 2.0

    for _ in range(cantidad * 6):
        if len(momentos) >= cantidad:
            break
        candidatos = np.where(libre, s, -np.inf)
        p = int(np.argmax(candidatos))
        if not np.isfinite(candidatos[p]):
            break
        # Zona "caliente" alrededor del pico.
        umbral = mediana + 0.5 * (s[p] - mediana)
        izq = p
        while izq > 0 and s[izq - 1] > umbral and (p - izq) * PASO < dur_max:
            izq -= 1
        der = p
        while der < n - 1 and s[der + 1] > umbral and (der - p) * PASO < dur_max:
            der += 1
        a = izq * PASO - 6.0   # contexto previo
        b = der * PASO + 3.0   # dejar ver la reacción
        a, b = _ajustar_longitud(a, b, p * PASO, dur_min, dur_max, total)
        a = _a_pausa(an.volumen, a, 1.5)
        b = _a_pausa(an.volumen, b, 1.5)
        if b - a < dur_min:
            a, b = _ajustar_longitud(a, b, p * PASO, dur_min, dur_max, total)
        a, b = _recortar_solapes(a, b, p * PASO, ocupado, hueco)
        libre[max(0, int((p * PASO - 4) / PASO)):int((p * PASO + 4) / PASO) + 1] = False
        if b - a < max(5.0, dur_min * 0.75):
            continue
        ocupado.append((a, b))
        ia, ib = int(a / PASO), max(int(a / PASO) + 1, int(b / PASO))
        libre[max(0, ia - int(hueco / PASO)):ib + int(hueco / PASO)] = False
        valor = float(0.6 * s[p] + 0.4 * np.mean(s[ia:ib]))
        momentos.append(Momento(round(a, 2), round(b, 2), p * PASO, valor))

    calificar(momentos)
    return momentos


def calificar(momentos: list[Momento]) -> None:
    if not momentos:
        return
    vmin = min(m.valor for m in momentos)
    vmax = max(m.valor for m in momentos)
    for m in momentos:
        m.nota = 100 if vmax == vmin else round(55 + 45 * (m.valor - vmin) / (vmax - vmin))


def _ajustar_longitud(a: float, b: float, pico: float, dmin: float, dmax: float,
                      total: float) -> tuple[float, float]:
    largo = b - a
    if largo < dmin:
        falta = dmin - largo
        a -= falta * 0.65
        b += falta * 0.35
    elif largo > dmax:
        a = max(a, pico - dmax * 0.65)
        b = a + dmax
    if a < 0:
        b, a = b - a, 0.0
    if b > total:
        a, b = max(0.0, a - (b - total)), total
    return a, b


def _a_pausa(volumen: np.ndarray, t: float, margen: float) -> float:
    i = int(t / PASO)
    k = int(margen / PASO)
    lo, hi = max(0, i - k), min(len(volumen), i + k + 1)
    if lo >= hi:
        return t
    return (lo + int(np.argmin(volumen[lo:hi]))) * PASO


def _recortar_solapes(a: float, b: float, pico: float, ocupado: list[tuple[float, float]],
                      hueco: float) -> tuple[float, float]:
    for oa, ob in ocupado:
        if a < ob + hueco and b > oa - hueco:
            if pico >= ob:
                a = max(a, ob + hueco)
            else:
                b = min(b, oa - hueco)
    return a, b


# ---------------------------------------------------------------------------
# Explicación
# ---------------------------------------------------------------------------

ETIQUETAS = {
    "risa_chat": "😂 El chat se partió de risa",
    "hype_chat": "🔥 Hype en el chat",
    "chat": "💬 El chat explotó",
    "voz": "📢 Gritos / subidón de voz",
    "calor": "▶️ Lo más repetido del vídeo",
    "escenas": "🎬 Mucha acción en pantalla",
}


def explicar(an: Analisis, m: Momento, chat: Optional[Chat]) -> str:
    ia, ib = int(m.inicio / PASO), max(int(m.inicio / PASO) + 1, int(m.fin / PASO))
    medias = {k: float(np.mean(np.sort(v[ia:ib])[-int(6 / PASO):])) for k, v in an.componentes.items()}
    razones = [ETIQUETAS[k] for k, v in sorted(medias.items(), key=lambda kv: -kv[1])
               if v > 0.8 and k in ETIQUETAS][:2]
    if chat:
        top = chat.palabras_destacadas(m.inicio, m.fin)
        if top:
            razones.append(" ".join(f"{p}×{c}" for p, c in top))
    return " · ".join(razones) or "Momento con más intensidad"
