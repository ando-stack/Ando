"""Acceso a vídeo: ffmpeg, yt-dlp, descargas, directos y fuentes remotas."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Callable, Optional

Progreso = Callable[[float, str], None]


class ClipError(Exception):
    """Error con un mensaje pensado para mostrarse al usuario."""


def sin_progreso(_pct: float, _msg: str) -> None:
    pass


def subprogreso(progreso: Progreso, desde: float, hasta: float) -> Progreso:
    """Convierte el 0-100 de una fase en el tramo [desde, hasta] del total."""
    return lambda p, m: progreso(desde + (hasta - desde) * max(0.0, min(100.0, p)) / 100, m)


# ---------------------------------------------------------------------------
# ffmpeg
# ---------------------------------------------------------------------------

def ffmpeg_bin() -> str:
    """Ruta de ffmpeg (el del sistema o el que trae imageio-ffmpeg)."""
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


def ffmpeg(args: list[str], cwd: Optional[str] = None) -> str:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", *args]
    res = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        cola = res.stderr.decode("utf-8", "replace")[-1500:]
        raise ClipError(f"ffmpeg falló:\n{cola}")
    return res.stderr.decode("utf-8", "replace")


def duracion_archivo(ruta: str) -> float:
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


def _cabeceras(cab: dict) -> list[str]:
    if not cab:
        return []
    return ["-headers", "".join(f"{k}: {v}\r\n" for k, v in cab.items())]


# ---------------------------------------------------------------------------
# Fuente de vídeo (archivo local o enlaces directos de la plataforma)
# ---------------------------------------------------------------------------

@dataclass
class Fuente:
    """De dónde sacar la imagen y el sonido de los clips.

    `entradas` tiene una (vídeo+audio juntos) o dos (vídeo, audio) rutas/URLs.
    Con URLs remotas, ffmpeg descarga solo el trozo que necesita cada clip.
    """

    entradas: list[tuple[str, dict]]
    local: bool = True
    cabeceras: dict = field(default_factory=dict)

    def args_entrada(self, inicio: float) -> tuple[list[str], list[str]]:
        args: list[str] = []
        for url, cab in self.entradas:
            if not self.local:
                args += _cabeceras(cab)
            args += ["-ss", f"{inicio:.3f}", "-i", url]
        audio = "1:a:0" if len(self.entradas) > 1 else "0:a:0?"
        return args, ["-map", audio]


def fuente_local(ruta: str) -> Fuente:
    return Fuente(entradas=[(os.path.abspath(ruta), {})], local=True)


# ---------------------------------------------------------------------------
# yt-dlp
# ---------------------------------------------------------------------------

def _ydl_base() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "ffmpeg_location": ffmpeg_bin(),
        "retries": 5,
        "fragment_retries": 10,
    }


def formato_video(calidad_max: int) -> str:
    return (f"bv*[height<={calidad_max}]+ba/b[height<={calidad_max}]/"
            f"bv*+ba/b")


def obtener_info(url: str, formato: Optional[str] = None) -> dict:
    import yt_dlp

    opciones = _ydl_base()
    if formato:
        opciones["format"] = formato
    try:
        with yt_dlp.YoutubeDL(opciones) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        raise ClipError(
            "No se pudo leer el enlace. Comprueba que es público y correcto "
            f"(los VODs solo para suscriptores no se pueden).\n({exc})"
        ) from exc
    if info.get("_type") == "playlist":
        entradas = [e for e in info.get("entries") or [] if e]
        if not entradas:
            raise ClipError("La lista de reproducción está vacía.")
        return obtener_info(entradas[0].get("webpage_url") or entradas[0]["url"], formato)
    return info


def fuente_remota(info: dict) -> Optional[Fuente]:
    """Enlaces directos al vídeo elegido por yt-dlp, para cortar sin descargarlo entero."""
    formatos = info.get("requested_formats") or ([info] if info.get("url") else [])
    if not formatos:
        return None
    if any(f.get("protocol", "").startswith(("http_dash_segments", "f4m", "ism")) for f in formatos):
        return None  # fragmentados raros: mejor descargar entero
    entradas = [(f["url"], f.get("http_headers") or info.get("http_headers") or {}) for f in formatos]
    return Fuente(entradas=entradas, local=False)


def _gancho(progreso: Progreso, texto: str):
    def gancho(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            hecho = d.get("downloaded_bytes") or 0
            if total:
                progreso(min(99.0, hecho * 100 / total), texto)
            elif d.get("fragment_count"):
                progreso(min(99.0, (d.get("fragment_index") or 0) * 100 / d["fragment_count"]), texto)
    return gancho


def _buscar(carpeta: str, prefijo: str) -> str:
    for nombre in sorted(os.listdir(carpeta)):
        if nombre.startswith(prefijo + ".") and not nombre.endswith((".part", ".ytdl")):
            return os.path.join(carpeta, nombre)
    raise ClipError("La descarga terminó pero no se encontró el archivo.")


def descargar_audio(url: str, carpeta: str, progreso: Progreso = sin_progreso) -> str:
    """Descarga solo el audio (rápido incluso en directos resubidos de horas)."""
    import yt_dlp

    os.makedirs(carpeta, exist_ok=True)
    opciones = {
        **_ydl_base(),
        "outtmpl": os.path.join(carpeta, "audio.%(ext)s"),
        "format": "ba/ba*/wa*/w",
        "concurrent_fragment_downloads": 8,
        "progress_hooks": [_gancho(progreso, "Descargando el audio para analizarlo…")],
    }
    try:
        with yt_dlp.YoutubeDL(opciones) as ydl:
            ydl.download([url])
    except Exception as exc:
        raise ClipError(f"Falló la descarga del audio.\n({exc})") from exc
    return _buscar(carpeta, "audio")


def descargar_video(url: str, carpeta: str, progreso: Progreso = sin_progreso,
                    calidad_max: int = 1080) -> str:
    import yt_dlp

    os.makedirs(carpeta, exist_ok=True)
    opciones = {
        **_ydl_base(),
        "outtmpl": os.path.join(carpeta, "video.%(ext)s"),
        "format": formato_video(calidad_max),
        "merge_output_format": "mp4",
        "concurrent_fragment_downloads": 8,
        "progress_hooks": [_gancho(progreso, "Descargando vídeo…")],
    }
    try:
        with yt_dlp.YoutubeDL(opciones) as ydl:
            ydl.download([url])
    except Exception as exc:
        raise ClipError(f"Falló la descarga del vídeo.\n({exc})") from exc
    return _buscar(carpeta, "video")


def grabar_directo(info: dict, carpeta: str, minutos: float,
                   progreso: Progreso = sin_progreso) -> str:
    """Graba los próximos `minutos` de un directo con ffmpeg."""
    formatos = info.get("requested_formats") or [info]
    entradas: list[str] = []
    for f in formatos:
        entradas += _cabeceras(f.get("http_headers") or info.get("http_headers") or {})
        entradas += ["-i", f["url"]]

    segundos = max(60, int(minutos * 60))
    os.makedirs(carpeta, exist_ok=True)
    salida = os.path.join(carpeta, "directo.mp4")
    mapas = (["-map", "0:v:0?", "-map", "0:a:0?"] if len(formatos) == 1
             else ["-map", "0:v:0", "-map", "1:a:0"])
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", *entradas, *mapas,
           "-t", str(segundos), "-c", "copy", "-progress", "pipe:1", "-nostats", salida]
    registro_ruta = os.path.join(carpeta, "grabacion.log")
    with open(registro_ruta, "w", encoding="utf-8") as registro:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=registro, text=True)
        assert proc.stdout is not None
        for linea in proc.stdout:
            if linea.startswith("out_time_us="):
                try:
                    seg = int(linea.split("=", 1)[1]) / 1e6
                except ValueError:
                    continue
                resta = max(0, segundos - seg)
                progreso(min(99.0, seg * 100 / segundos),
                         f"Grabando directo… faltan {int(resta // 60)}:{int(resta % 60):02d}")
        proc.wait()
    if not os.path.exists(salida) or os.path.getsize(salida) < 10_000:
        with open(registro_ruta, encoding="utf-8", errors="replace") as f:
            error = f.read()[-800:]
        raise ClipError(f"No se pudo grabar el directo.\n{error}")
    return salida
