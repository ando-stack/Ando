"""Corte de clips con ffmpeg, en horizontal o vertical, con subtítulos opcionales."""

from __future__ import annotations

import os
from typing import Optional

from .medios import Fuente, ffmpeg

FORMATOS = {
    "vertical_fondo": "Vertical 9:16 con fondo desenfocado (TikTok / Reels / Shorts)",
    "vertical": "Vertical 9:16 recortado al centro",
    "original": "Original (horizontal)",
}


def _filtro(formato: str) -> str:
    if formato == "vertical":
        return "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920,setsar=1"
    if formato == "vertical_fondo":
        return ("split[a][b];"
                "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
                "boxblur=20:2[fondo];"
                "[b]scale=1080:1920:force_original_aspect_ratio=decrease[frente];"
                "[fondo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1")
    return "scale=-2:'min(ih,1080)',setsar=1"


def _tiempo_srt(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def escribir_srt(trozos: list, ruta: str) -> None:
    with open(ruta, "w", encoding="utf-8") as f:
        for k, (a, b, texto) in enumerate(trozos, 1):
            f.write(f"{k}\n{_tiempo_srt(a)} --> {_tiempo_srt(b)}\n{texto.upper()}\n\n")


def cortar_clip(fuente: Fuente, salida: str, inicio: float, fin: float,
                formato: str = "vertical_fondo", subtitulos: Optional[list] = None) -> None:
    """Genera el clip MP4 (+ miniatura .jpg). `subtitulos`: [(ini, fin, texto)] del clip."""
    carpeta = os.path.dirname(os.path.abspath(salida))
    base = os.path.splitext(os.path.basename(salida))[0]
    duracion = max(0.5, fin - inicio)
    filtro = _filtro(formato)

    if subtitulos:
        srt = f"{base}.srt"
        escribir_srt(subtitulos, os.path.join(carpeta, srt))
        tam = 14 if formato == "original" else 13
        estilo = (f"FontName=Arial,FontSize={tam},Bold=1,PrimaryColour=&H00FFFFFF,"
                  "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
                  "Alignment=2,MarginV=60")
        filtro += f",subtitles={srt}:force_style='{estilo}'"

    entradas, mapa_audio = fuente.args_entrada(inicio)
    ffmpeg([
        *entradas, "-t", f"{duracion:.3f}",
        "-filter_complex", f"[0:v]{filtro}[v]", "-map", "[v]", *mapa_audio,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart",
        os.path.basename(salida),
    ], cwd=carpeta)

    ffmpeg(["-ss", f"{min(duracion / 2, 3):.3f}", "-i", salida, "-frames:v", "1",
            "-vf", "scale=-2:360", "-q:v", "4", os.path.join(carpeta, f"{base}.jpg")])
