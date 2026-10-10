"""Proceso completo de AutoClips: enlace/archivo -> momentos destacados -> clips listos.

Todo gratis y local:
  * yt-dlp  -> YouTube, Twitch (directos y VODs), Kick, TikTok, X, ...
  * ffmpeg  -> audio, vídeo y cortes
  * numpy   -> puntuación de cada momento
  * faster-whisper (opcional) -> detecta risas en la voz y genera subtítulos
"""

from __future__ import annotations

import json
import os
import threading
import zipfile
from dataclasses import asdict, dataclass, field
from typing import Optional, Union

from . import voz
from .analisis import ESTILOS, Momento, calificar, cambios_de_escena, elegir_momentos, energia_audio, explicar, puntuar
from .chat import Chat, OyenteTwitch, canal_twitch, chat_twitch_vod, chat_youtube, id_vod_twitch, tiene_chat_youtube
from .cortes import FORMATOS, cortar_clip
from .medios import (ClipError, Fuente, Progreso, descargar_audio, descargar_video, duracion_archivo,
                     formato_video, fuente_local, fuente_remota, grabar_directo, obtener_info,
                     sin_progreso, subprogreso)

DURACION_AUTO = (15.0, 60.0)


@dataclass
class Opciones:
    cantidad: int = 5
    duracion: Union[str, float] = "auto"  # "auto" (según el momento) o segundos fijos
    formato: str = "vertical_fondo"
    estilo: str = "todo"
    ia_voz: bool = True        # detectar risas/reacciones con IA (si está instalada)
    subtitulos: bool = False
    escenas: bool = True       # cortes de cámara (solo con vídeo descargado/subido)
    chat: bool = True
    minutos_directo: float = 10
    calidad_max: int = 1080
    titulo: Optional[str] = None


@dataclass
class Clip:
    numero: int
    archivo: str
    miniatura: str
    inicio: float
    fin: float
    puntuacion: int
    motivo: str = ""
    texto: Optional[str] = None


@dataclass
class Resultado:
    titulo: str
    duracion_fuente: float
    senales: list[str]
    clips: list[Clip] = field(default_factory=list)
    zip: Optional[str] = None
    avisos: list[str] = field(default_factory=list)

    def a_dict(self) -> dict:
        return asdict(self)


def _rango_duracion(op: Opciones) -> tuple[float, float]:
    if str(op.duracion).lower() == "auto":
        return DURACION_AUTO
    d = max(5.0, min(600.0, float(op.duracion)))
    return d, d


def procesar(origen: str, carpeta: str, op: Optional[Opciones] = None,
             progreso: Progreso = sin_progreso) -> Resultado:
    """`origen` es un enlace o la ruta de un vídeo. Deja los clips y un ZIP en `carpeta`."""
    op = op or Opciones()
    if op.formato not in FORMATOS:
        raise ClipError(f"Formato desconocido: {op.formato}")
    if op.estilo not in ESTILOS:
        op.estilo = "todo"
    op.cantidad = max(1, min(50, int(op.cantidad)))
    os.makedirs(carpeta, exist_ok=True)
    trabajo = os.path.join(carpeta, "fuente")
    avisos: list[str] = []

    info: dict = {}
    chat: Optional[Chat] = None
    video_local: Optional[str] = None
    fuente: Optional[Fuente] = None
    audio: str

    # 1) Conseguir el audio (para analizar), el chat y de dónde cortar el vídeo.
    if os.path.isfile(origen):
        video_local = origen
        info = {"title": op.titulo or os.path.basename(origen)}
        p_analisis = 0.0
    else:
        progreso(1, "Leyendo el enlace…")
        info = obtener_info(origen, formato_video(op.calidad_max))
        if info.get("is_live"):
            canal = canal_twitch(origen)
            oyente = OyenteTwitch(canal) if (canal and op.chat) else None
            if oyente:
                oyente.start()
            video_local = grabar_directo(info, trabajo, op.minutos_directo, subprogreso(progreso, 2, 40))
            if oyente:
                chat = oyente.parar()
            p_analisis = 40.0
        else:
            chat_hilo: dict = {}
            hilo = None
            if op.chat:
                hilo = threading.Thread(target=_leer_chat, args=(origen, info, trabajo, chat_hilo),
                                        daemon=True)
                hilo.start()
            audio = descargar_audio(origen, trabajo, subprogreso(progreso, 2, 33))
            if hilo:
                progreso(33, "Leyendo el chat del directo…")
                hilo.join()
                chat = chat_hilo.get("chat")
            fuente = fuente_remota(info)
            p_analisis = 35.0

    if video_local:
        fuente = fuente_local(video_local)
        audio = video_local
    if chat is not None and not chat:
        chat = None

    # 2) Analizar.
    total = duracion_archivo(audio)
    if total < 5:
        raise ClipError("El vídeo es demasiado corto.")
    dur_min, dur_max = _rango_duracion(op)
    if dur_min >= total:
        dur_min = dur_max = total
        avisos.append("El vídeo es más corto que la duración pedida: se genera un único clip.")

    usar_escenas = op.escenas and video_local is not None
    fin_audio = p_analisis + (12 if usar_escenas else 15)
    volumen = energia_audio(audio, total, subprogreso(progreso, p_analisis, fin_audio))
    cortes = None
    if usar_escenas:
        cortes = cambios_de_escena(video_local, len(volumen), total,
                                   subprogreso(progreso, fin_audio, fin_audio + 12))
        fin_audio += 12
    progreso(fin_audio, "Buscando los mejores momentos…")
    an = puntuar(volumen, info, chat, cortes, op.estilo)

    usar_voz = (op.ia_voz or op.subtitulos) and voz.disponible()
    if (op.ia_voz or op.subtitulos) and not voz.disponible():
        avisos.append("IA de voz no instalada: sin detección de risas ni subtítulos "
                      "(instala 'faster-whisper', ver README).")
    extra = op.cantidad + 3 if (usar_voz and op.ia_voz) else 0
    momentos = elegir_momentos(an, op.cantidad + extra, dur_min, dur_max, total)
    if not momentos:
        raise ClipError("No se encontraron momentos destacados.")
    if len(momentos) < op.cantidad:
        avisos.append(f"Solo se encontraron {len(momentos)} momentos que no se repitan.")

    # 3) IA de voz: re-ordenar los candidatos según risas/reacciones habladas.
    motivos_voz: dict[int, str] = {}
    p_voz = fin_audio + 2
    if usar_voz and op.ia_voz:
        p_fin_voz = p_voz + 20
        for k, m in enumerate(momentos):
            progreso(p_voz + (p_fin_voz - p_voz) * k / len(momentos),
                     f"Escuchando candidatos con IA ({k + 1}/{len(momentos)})…")
            try:
                m.transcripcion = voz.transcribir(audio, m.inicio, m.fin)
            except Exception as exc:  # sin internet la 1ª vez para bajar el modelo, etc.
                avisos.append(f"La IA de voz no pudo cargarse (la 1ª vez necesita internet) y se omitió: {exc}")
                usar_voz = False
                break
            bonus, motivo = voz.bonus_gracia(m.transcripcion)
            peso = 1.6 if op.estilo == "graciosos" else 1.0
            m.valor += bonus * peso
            if motivo:
                motivos_voz[id(m)] = motivo
        p_voz = p_fin_voz
    momentos = sorted(momentos, key=lambda m: -m.valor)[:op.cantidad]
    calificar(momentos)

    # 3b) Cortar en frases completas: que ningún clip empiece o acabe a mitad de frase.
    if usar_voz:
        for k, m in enumerate(momentos):
            progreso(p_voz + 4 * k / len(momentos),
                     f"Ajustando cortes a frases completas ({k + 1}/{len(momentos)})…")
            try:
                ini, fin, subs = voz.ajustar_a_frases(audio, m.inicio, m.fin, total,
                                                      largo_max=max(dur_max, dur_min + 10))
            except Exception:
                continue
            base = ini  # los subtítulos vienen relativos a este inicio
            # Sin pisar a los clips mejor puntuados ya ajustados.
            for otro in momentos[:k]:
                if ini < otro.fin and fin > otro.inicio:
                    if m.pico >= otro.fin:
                        ini = max(ini, otro.fin)
                    else:
                        fin = min(fin, otro.inicio)
            if fin - ini >= 5:
                m.inicio, m.fin = round(ini, 2), round(fin, 2)
                d = m.inicio - base
                m.transcripcion = [(max(0.0, a - d), b - d, t) for a, b, t in subs
                                   if b - d > 0 and a - d < m.fin - m.inicio]
        p_voz += 4

    # 4) Cortar.
    resultado = Resultado(titulo=info.get("title") or os.path.basename(origen),
                          duracion_fuente=total, senales=an.senales, avisos=avisos)
    if usar_voz and op.ia_voz:
        resultado.senales.append("risas en la voz (IA)")
    inicio_cortes = p_voz + 1
    tramo = (97 - inicio_cortes) / len(momentos)
    for k, m in enumerate(momentos, 1):
        progreso(inicio_cortes + tramo * (k - 1), f"Creando clip {k} de {len(momentos)}…")
        subs = None
        if op.subtitulos and usar_voz:
            try:
                subs = m.transcripcion or voz.transcribir(audio, m.inicio, m.fin)
            except Exception as exc:
                avisos.append(f"No se pudieron crear subtítulos ({exc}).")
        nombre = f"clip_{k:02d}.mp4"
        salida = os.path.join(carpeta, nombre)
        try:
            cortar_clip(fuente, salida, m.inicio, m.fin, op.formato, subs)
        except ClipError:
            if fuente is None or fuente.local:
                raise
            # La web no deja cortar a distancia: descargamos el vídeo entero y seguimos.
            progreso(inicio_cortes, "Descargando el vídeo completo…")
            fuente = fuente_local(descargar_video(origen, trabajo, sin_progreso, op.calidad_max))
            cortar_clip(fuente, salida, m.inicio, m.fin, op.formato, subs)

        motivo = explicar(an, m, chat)
        if id(m) in motivos_voz:
            motivo = motivos_voz[id(m)] + " · " + motivo
        resultado.clips.append(Clip(
            numero=k, archivo=nombre, miniatura=f"clip_{k:02d}.jpg",
            inicio=m.inicio, fin=m.fin, puntuacion=m.nota, motivo=motivo,
            texto=" ".join(t for _, _, t in m.transcripcion) if m.transcripcion else None,
        ))

    progreso(98, "Empaquetando ZIP…")
    with zipfile.ZipFile(os.path.join(carpeta, "clips.zip"), "w", zipfile.ZIP_STORED) as z:
        for c in resultado.clips:
            z.write(os.path.join(carpeta, c.archivo), c.archivo)
    resultado.zip = "clips.zip"
    with open(os.path.join(carpeta, "resultado.json"), "w", encoding="utf-8") as f:
        json.dump(resultado.a_dict(), f, ensure_ascii=False, indent=2)
    progreso(100, "¡Clips listos!")
    return resultado


def _leer_chat(url: str, info: dict, carpeta: str, salida: dict) -> None:
    try:
        vod = id_vod_twitch(info)
        if vod:
            salida["chat"] = chat_twitch_vod(vod, float(info.get("duration") or 0) or 36000)
        elif tiene_chat_youtube(info):
            salida["chat"] = chat_youtube(url, os.path.join(carpeta, "chat"))
    except Exception:
        pass  # sin chat también funciona, solo con el audio


__all__ = ["ClipError", "Clip", "ESTILOS", "FORMATOS", "Momento", "Opciones", "Resultado", "procesar"]
