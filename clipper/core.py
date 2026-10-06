"""Motor de AutoClips: descarga, análisis de momentos destacados y corte de clips.

Todo funciona con herramientas gratuitas y locales:
  * yt-dlp  -> descarga vídeos y directos (YouTube, Twitch, Kick, TikTok, X, ...)
  * ffmpeg  -> lee el audio/vídeo y genera los clips
  * numpy   -> calcula la puntuación de cada momento
  * faster-whisper (opcional) -> subtítulos automáticos
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import zipfile
from dataclasses import asdict, dataclass, field
from typing import Callable, Optional

import numpy as np

# Resolución temporal del análisis (segundos por muestra).
PASO = 0.5

Progreso = Callable[[float, str], None]


class ClipError(Exception):
    """Error con un mensaje pensado para mostrarse al usuario."""


def _sin_progreso(_pct: float, _msg: str) -> None:
    pass


# ---------------------------------------------------------------------------
# ffmpeg
# ---------------------------------------------------------------------------

def ffmpeg_bin() -> str:
    """Devuelve la ruta de ffmpeg (el del sistema o el que trae imageio-ffmpeg)."""
    ruta = shutil.which("ffmpeg")
    if ruta:
        return ruta
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - depende del sistema
        raise ClipError(
            "No se encontró ffmpeg. Instálalo (https://ffmpeg.org) o ejecuta "
            "'pip install imageio-ffmpeg'."
        ) from exc


def _ffmpeg(args: list[str], cwd: Optional[str] = None) -> str:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", *args]
    res = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        cola = res.stderr.decode("utf-8", "replace")[-1500:]
        raise ClipError(f"ffmpeg falló:\n{cola}")
    return res.stderr.decode("utf-8", "replace")


def duracion_video(ruta: str) -> float:
    """Lee la duración del archivo a partir de la salida de ffmpeg."""
    res = subprocess.run(
        [ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", ruta],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    texto = res.stderr.decode("utf-8", "replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", texto)
    if not m:
        raise ClipError("No se pudo leer la duración del vídeo (¿archivo dañado?).")
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


def _tamano_video(ruta: str) -> tuple[int, int]:
    res = subprocess.run(
        [ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", ruta],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    texto = res.stderr.decode("utf-8", "replace")
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", texto)
    if not m:
        raise ClipError("El archivo no contiene vídeo.")
    return int(m.group(1)), int(m.group(2))


# ---------------------------------------------------------------------------
# Descarga
# ---------------------------------------------------------------------------

def _ydl_base() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "ffmpeg_location": ffmpeg_bin(),
    }


def obtener_info(url: str) -> dict:
    import yt_dlp

    try:
        with yt_dlp.YoutubeDL(_ydl_base()) as ydl:
            return ydl.extract_info(url, download=False)
    except Exception as exc:
        raise ClipError(
            f"No se pudo leer el enlace. Comprueba que es público y correcto.\n({exc})"
        ) from exc


def descargar(
    url: str,
    carpeta: str,
    progreso: Progreso = _sin_progreso,
    minutos_directo: float = 10,
    calidad_max: int = 1080,
) -> tuple[str, dict]:
    """Descarga un vídeo (o graba un directo) y devuelve (ruta_mp4, info)."""
    import yt_dlp

    os.makedirs(carpeta, exist_ok=True)
    progreso(0, "Leyendo el enlace…")
    info = obtener_info(url)

    if info.get("_type") == "playlist":
        entradas = [e for e in info.get("entries") or [] if e]
        if not entradas:
            raise ClipError("La lista de reproducción está vacía.")
        info = entradas[0]
        url = info.get("webpage_url") or url

    if info.get("is_live"):
        ruta = _grabar_directo(url, carpeta, progreso, minutos_directo, calidad_max)
        return ruta, info

    destino = os.path.join(carpeta, "fuente.%(ext)s")

    def gancho(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            hecho = d.get("downloaded_bytes") or 0
            if total:
                progreso(min(99.0, hecho * 100 / total), "Descargando vídeo…")
        elif d.get("status") == "finished":
            progreso(99, "Uniendo audio y vídeo…")

    opciones = {
        **_ydl_base(),
        "outtmpl": destino,
        "format": (
            f"bv*[height<={calidad_max}][ext=mp4]+ba[ext=m4a]/"
            f"bv*[height<={calidad_max}]+ba/b[height<={calidad_max}]/bv*+ba/b"
        ),
        "merge_output_format": "mp4",
        "progress_hooks": [gancho],
    }
    try:
        with yt_dlp.YoutubeDL(opciones) as ydl:
            ydl.download([url])
    except Exception as exc:
        raise ClipError(f"Falló la descarga del vídeo.\n({exc})") from exc

    for nombre in sorted(os.listdir(carpeta)):
        if nombre.startswith("fuente.") and not nombre.endswith((".part", ".ytdl")):
            progreso(100, "Descarga completa")
            return os.path.join(carpeta, nombre), info
    raise ClipError("La descarga terminó pero no se encontró el archivo.")


def _grabar_directo(
    url: str, carpeta: str, progreso: Progreso, minutos: float, calidad_max: int
) -> str:
    """Graba los próximos `minutos` de un directo con ffmpeg."""
    import yt_dlp

    opciones = {**_ydl_base(), "format": f"b[height<={calidad_max}]/b/bv*+ba"}
    with yt_dlp.YoutubeDL(opciones) as ydl:
        info = ydl.extract_info(url, download=False)

    formatos = info.get("requested_formats") or [info]
    entradas: list[str] = []
    for f in formatos:
        cabeceras = f.get("http_headers") or info.get("http_headers") or {}
        if cabeceras:
            entradas += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in cabeceras.items())]
        entradas += ["-i", f["url"]]
    if not entradas:
        raise ClipError("No se encontró la señal del directo.")

    segundos = max(60, int(minutos * 60))
    salida = os.path.join(carpeta, "fuente.mp4")
    mapas = ["-map", "0:v:0?", "-map", "0:a:0?"] if len(formatos) == 1 else ["-map", "0:v:0", "-map", "1:a:0"]
    cmd = [
        ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", *entradas, *mapas,
        "-t", str(segundos), "-c", "copy",
        "-progress", "pipe:1", "-nostats", salida,
    ]
    os.makedirs(carpeta, exist_ok=True)
    registro_ruta = os.path.join(carpeta, "grabacion.log")
    with open(registro_ruta, "w", encoding="utf-8") as registro:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=registro, text=True)
        assert proc.stdout is not None
        _seguir_grabacion(proc, segundos, progreso)
    if not os.path.exists(salida) or os.path.getsize(salida) < 10_000:
        with open(registro_ruta, encoding="utf-8", errors="replace") as f:
            error = f.read()[-800:]
        raise ClipError(f"No se pudo grabar el directo.\n{error}")
    progreso(100, "Grabación del directo completa")
    return salida


def _seguir_grabacion(proc: subprocess.Popen, segundos: int, progreso: Progreso) -> None:
    for linea in proc.stdout:
        if linea.startswith("out_time_us="):
            try:
                seg = int(linea.split("=", 1)[1]) / 1e6
            except ValueError:
                continue
            restante = max(0, segundos - seg)
            progreso(min(99.0, seg * 100 / segundos),
                     f"Grabando directo… faltan {int(restante // 60)}:{int(restante % 60):02d}")
    proc.wait()


# ---------------------------------------------------------------------------
# Análisis
# ---------------------------------------------------------------------------

def energia_audio(ruta: str, duracion: float, progreso: Progreso = _sin_progreso) -> np.ndarray:
    """Volumen (dB) en ventanas de PASO segundos, leído en streaming para no gastar RAM."""
    sr = 8000
    muestras_ventana = int(sr * PASO)
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", ruta, "-vn", "-ac", "1",
           "-ar", str(sr), "-f", "s16le", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    bloque = muestras_ventana * 2 * 240  # 2 minutos de audio por lectura
    resto = b""
    niveles: list[np.ndarray] = []
    leidos = 0
    while True:
        datos = proc.stdout.read(bloque)
        if not datos:
            break
        datos = resto + datos
        util = len(datos) - len(datos) % (muestras_ventana * 2)
        resto = datos[util:]
        if util:
            x = np.frombuffer(datos[:util], dtype=np.int16).astype(np.float32) / 32768.0
            x = x.reshape(-1, muestras_ventana)
            rms = np.sqrt(np.mean(x * x, axis=1) + 1e-10)
            niveles.append(20 * np.log10(rms))
            leidos += x.shape[0]
            if duracion > 0:
                progreso(min(99.0, leidos * PASO * 100 / duracion), "Escuchando el audio…")
    proc.wait()
    if not niveles:
        return np.zeros(max(1, int(duracion / PASO)), dtype=np.float32)
    return np.concatenate(niveles)


def cambios_de_escena(ruta: str, n: int, progreso: Progreso = _sin_progreso,
                      duracion: float = 0) -> np.ndarray:
    """Número de cortes de cámara por ventana (vídeo reducido para ir rápido)."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", ruta, "-an", "-sn",
           "-vf", "fps=3,scale=96:-2,select='gte(scene,0)',"
                  "metadata=mode=print:key=lavfi.scene_score:file=-",
           "-nostats", "-f", "null", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                            errors="replace")
    assert proc.stdout is not None
    cortes = np.zeros(n, dtype=np.float32)
    instante = 0.0
    ultimo_aviso = 0.0
    for linea in proc.stdout:
        m = re.search(r"pts_time:([\d.]+)", linea)
        if m:
            instante = float(m.group(1))
            if duracion > 0 and instante - ultimo_aviso >= 5:
                ultimo_aviso = instante
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


def _suavizar(x: np.ndarray, segundos: float) -> np.ndarray:
    k = max(1, min(len(x), int(segundos / PASO)))
    if k <= 1:
        return x.astype(np.float32)
    nucleo = np.ones(k, dtype=np.float32) / k
    return np.convolve(x, nucleo, mode="same")


def _z(x: np.ndarray) -> np.ndarray:
    """Normalización robusta (mediana / MAD) recortada a [-3, 3]."""
    med = np.median(x)
    mad = np.median(np.abs(x - med)) * 1.4826
    if mad < 1e-6:
        mad = float(np.std(x)) or 1.0
    return np.clip((x - med) / mad, -3, 3)


def _mapa_de_calor(info: Optional[dict], n: int) -> Optional[np.ndarray]:
    """Curva de 'lo más repetido' de YouTube, si existe."""
    calor = (info or {}).get("heatmap")
    if not calor:
        return None
    curva = np.zeros(n, dtype=np.float32)
    for tramo in calor:
        a = int(float(tramo.get("start_time", 0)) / PASO)
        b = int(float(tramo.get("end_time", 0)) / PASO)
        curva[max(0, a):min(n, max(a + 1, b))] = float(tramo.get("value", 0))
    return curva if curva.any() else None


def puntuar(volumen: np.ndarray, cortes: Optional[np.ndarray], info: Optional[dict]) -> tuple[np.ndarray, list[str]]:
    """Combina las señales en una puntuación de 'interés' por ventana."""
    n = len(volumen)
    senales: list[str] = ["volumen"]
    vol = _suavizar(volumen, 2.0)
    base_local = _suavizar(volumen, 45.0)
    subidon = vol - base_local  # gritos, risas, reacciones respecto a lo que había antes

    puntos = 0.55 * _z(vol) + 0.75 * _z(subidon)

    silencio = volumen < (np.median(volumen) - 20)
    puntos -= 1.5 * _suavizar(silencio.astype(np.float32), 3.0)

    if cortes is not None and cortes.any():
        puntos += 0.35 * _z(_suavizar(cortes, 6.0))
        senales.append("cortes de cámara")

    calor = _mapa_de_calor(info, n)
    if calor is not None:
        puntos += 1.6 * _z(calor)
        senales.append("lo más visto de YouTube")

    return _suavizar(puntos, 1.0), senales


def elegir_momentos(
    puntos: np.ndarray,
    volumen: np.ndarray,
    cantidad: int,
    duracion_clip: float,
    duracion_total: float,
) -> list[tuple[float, float, float]]:
    """Elige los mejores tramos sin solaparse. Devuelve [(inicio, fin, puntuación)]."""
    n = len(puntos)
    w = max(1, int(round(duracion_clip / PASO)))
    if n <= w:
        return [(0.0, min(duracion_total, duracion_clip), 1.0)]

    acumulado = np.concatenate([[0.0], np.cumsum(puntos, dtype=np.float64)])
    medias = (acumulado[w:] - acumulado[:-w]) / w  # media del tramo que empieza en i
    # Que el clip termine en el momento fuerte, no justo después: premiamos el último tercio.
    tercio = max(1, w // 3)
    final = (acumulado[w:] - acumulado[w - tercio: n - tercio + 1]) / tercio
    valor = 0.7 * medias + 0.3 * final

    hueco = int(3 / PASO)
    disponible = np.ones_like(valor, dtype=bool)
    elegidos: list[tuple[int, float]] = []
    for _ in range(cantidad):
        candidatos = np.where(disponible, valor, -np.inf)
        i = int(np.argmax(candidatos))
        if not np.isfinite(candidatos[i]):
            break
        elegidos.append((i, float(valor[i])))
        disponible[max(0, i - w - hueco): i + w + hueco] = False

    if not elegidos:
        return []
    vmin = min(v for _, v in elegidos)
    vmax = max(v for _, v in elegidos)

    resultado = []
    for i, v in elegidos:
        ini = _ajustar_a_pausa(volumen, i, 3)
        fin = _ajustar_a_pausa(volumen, i + w, 3)
        if fin - ini < w * 0.6:
            ini, fin = i, i + w
        a = max(0.0, ini * PASO)
        b = min(duracion_total, fin * PASO)
        nota = 1.0 if vmax == vmin else 0.55 + 0.45 * (v - vmin) / (vmax - vmin)
        resultado.append((a, b, nota))
    return resultado


def _ajustar_a_pausa(volumen: np.ndarray, i: int, margen: int) -> int:
    """Mueve un corte a la ventana más silenciosa cercana para no cortar frases."""
    a = max(0, i - margen)
    b = min(len(volumen), i + margen + 1)
    if a >= b:
        return min(i, len(volumen))
    return a + int(np.argmin(volumen[a:b]))


# ---------------------------------------------------------------------------
# Corte y subtítulos
# ---------------------------------------------------------------------------

FORMATOS = {
    "original": "Original (horizontal)",
    "vertical": "Vertical 9:16 recortado (TikTok / Reels / Shorts)",
    "vertical_fondo": "Vertical 9:16 con fondo desenfocado",
}


def _filtro_video(formato: str, ancho: int, alto: int) -> str:
    if formato == "vertical":
        return ("crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',"
                "scale=1080:1920,setsar=1")
    if formato == "vertical_fondo":
        return ("split[a][b];"
                "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
                "boxblur=20:2[fondo];"
                "[b]scale=1080:1920:force_original_aspect_ratio=decrease[frente];"
                "[fondo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1")
    # Original: limitamos a 1080p para que pesen poco.
    if alto > 1080:
        return "scale=-2:1080,setsar=1"
    return "setsar=1"


def subtitulos_disponibles() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


_MODELO_WHISPER = None


def _transcribir(ruta_audio: str, modelo: str = "base") -> list[tuple[float, float, str]]:
    """Transcribe y agrupa en frases cortas (3-4 palabras) estilo TikTok."""
    global _MODELO_WHISPER
    from faster_whisper import WhisperModel

    if _MODELO_WHISPER is None or _MODELO_WHISPER[0] != modelo:
        _MODELO_WHISPER = (modelo, WhisperModel(modelo, device="cpu", compute_type="int8"))
    segmentos, _ = _MODELO_WHISPER[1].transcribe(ruta_audio, word_timestamps=True, vad_filter=True)

    trozos: list[tuple[float, float, str]] = []
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


def _tiempo_srt(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _escribir_srt(trozos: list[tuple[float, float, str]], ruta: str) -> None:
    with open(ruta, "w", encoding="utf-8") as f:
        for k, (a, b, texto) in enumerate(trozos, 1):
            f.write(f"{k}\n{_tiempo_srt(a)} --> {_tiempo_srt(b)}\n{texto.upper()}\n\n")


def cortar_clip(
    fuente: str,
    salida: str,
    inicio: float,
    fin: float,
    formato: str = "original",
    subtitulos: bool = False,
) -> Optional[str]:
    """Genera un clip MP4. Devuelve el texto transcrito si hubo subtítulos."""
    carpeta = os.path.dirname(os.path.abspath(salida))
    base = os.path.splitext(os.path.basename(salida))[0]
    ancho, alto = _tamano_video(fuente)
    filtro = _filtro_video(formato, ancho, alto)
    duracion = max(0.5, fin - inicio)
    texto = None

    if subtitulos and subtitulos_disponibles():
        audio = os.path.join(carpeta, f"{base}.wav")
        _ffmpeg(["-ss", f"{inicio:.3f}", "-i", fuente, "-t", f"{duracion:.3f}",
                 "-vn", "-ac", "1", "-ar", "16000", audio])
        try:
            trozos = _transcribir(audio)
        except Exception as exc:  # p. ej. sin internet para bajar el modelo la 1ª vez
            print(f"Aviso: no se pudieron generar subtítulos ({exc})")
            trozos = []
        finally:
            os.remove(audio)
        if trozos:
            srt = f"{base}.srt"
            _escribir_srt(trozos, os.path.join(carpeta, srt))
            tam = 14 if formato == "original" else 13
            estilo = (f"FontName=Arial,FontSize={tam},Bold=1,PrimaryColour=&H00FFFFFF,"
                      "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
                      "Alignment=2,MarginV=60")
            filtro += f",subtitles={srt}:force_style='{estilo}'"
            texto = " ".join(t for _, _, t in trozos)

    _ffmpeg([
        "-ss", f"{inicio:.3f}", "-i", os.path.abspath(fuente), "-t", f"{duracion:.3f}",
        "-filter_complex", f"[0:v]{filtro}[v]", "-map", "[v]", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        os.path.basename(salida),
    ], cwd=carpeta)

    miniatura = os.path.join(carpeta, f"{base}.jpg")
    _ffmpeg(["-ss", f"{min(duracion / 2, 3):.3f}", "-i", salida, "-frames:v", "1",
             "-vf", "scale=-2:360", "-q:v", "4", miniatura])
    return texto


# ---------------------------------------------------------------------------
# Proceso completo
# ---------------------------------------------------------------------------

@dataclass
class Clip:
    numero: int
    archivo: str
    miniatura: str
    inicio: float
    fin: float
    puntuacion: float
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


def generar_clips(
    fuente: str,
    carpeta: str,
    cantidad: int = 5,
    duracion_clip: float = 30,
    formato: str = "original",
    subtitulos: bool = False,
    analizar_escenas: bool = True,
    info: Optional[dict] = None,
    progreso: Progreso = _sin_progreso,
) -> Resultado:
    """Analiza `fuente` y deja los clips (y un ZIP) en `carpeta`."""
    if formato not in FORMATOS:
        raise ClipError(f"Formato desconocido: {formato}")
    os.makedirs(carpeta, exist_ok=True)
    cantidad = max(1, min(50, int(cantidad)))
    duracion_clip = max(5.0, min(600.0, float(duracion_clip)))

    total = duracion_video(fuente)
    if total < 5:
        raise ClipError("El vídeo es demasiado corto.")
    avisos: list[str] = []
    if duracion_clip >= total:
        duracion_clip = total
        cantidad = 1
        avisos.append("El vídeo es más corto que la duración pedida: se genera un único clip.")
    maximo = int(total // (duracion_clip + 3)) or 1
    if cantidad > maximo:
        avisos.append(f"Solo caben {maximo} clips de {int(duracion_clip)} s sin repetirse.")
        cantidad = maximo

    peso_escenas = 25 if analizar_escenas else 0
    peso_audio = 40 - peso_escenas // 2 if analizar_escenas else 40

    volumen = energia_audio(fuente, total, lambda p, m: progreso(p * peso_audio / 100, m))
    cortes = None
    if analizar_escenas:
        cortes = cambios_de_escena(
            fuente, len(volumen),
            lambda p, m: progreso(peso_audio + p * peso_escenas / 100, m), total,
        )
    progreso(peso_audio + peso_escenas, "Buscando los mejores momentos…")
    puntos, senales = puntuar(volumen, cortes, info)
    momentos = elegir_momentos(puntos, volumen, cantidad, duracion_clip, total)
    if not momentos:
        raise ClipError("No se encontraron momentos destacados.")

    if subtitulos and not subtitulos_disponibles():
        avisos.append("Subtítulos desactivados: instala 'faster-whisper' para usarlos.")
        subtitulos = False

    resultado = Resultado(
        titulo=(info or {}).get("title") or os.path.basename(fuente),
        duracion_fuente=total, senales=senales, avisos=avisos,
    )
    inicio_cortes = peso_audio + peso_escenas + 2
    tramo = (97 - inicio_cortes) / len(momentos)
    for k, (a, b, nota) in enumerate(momentos, 1):
        progreso(inicio_cortes + tramo * (k - 1), f"Creando clip {k} de {len(momentos)}…")
        nombre = f"clip_{k:02d}.mp4"
        texto = cortar_clip(fuente, os.path.join(carpeta, nombre), a, b, formato, subtitulos)
        resultado.clips.append(Clip(
            numero=k, archivo=nombre, miniatura=f"clip_{k:02d}.jpg",
            inicio=round(a, 2), fin=round(b, 2), puntuacion=round(nota * 100), texto=texto,
        ))

    progreso(98, "Empaquetando ZIP…")
    ruta_zip = os.path.join(carpeta, "clips.zip")
    with zipfile.ZipFile(ruta_zip, "w", zipfile.ZIP_STORED) as z:
        for c in resultado.clips:
            z.write(os.path.join(carpeta, c.archivo), c.archivo)
    resultado.zip = "clips.zip"

    with open(os.path.join(carpeta, "resultado.json"), "w", encoding="utf-8") as f:
        json.dump(resultado.a_dict(), f, ensure_ascii=False, indent=2)
    progreso(100, "¡Clips listos!")
    return resultado
