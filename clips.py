"""AutoClips desde la terminal.

Ejemplos:
    python clips.py "https://www.youtube.com/watch?v=XXXX" -n 5 -d 30
    python clips.py "https://www.twitch.tv/canal" --directo 15 -n 3 -f vertical
    python clips.py mi_video.mp4 -n 8 -d 45 -f vertical_fondo --subtitulos
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from clipper import FORMATOS, ClipError, descargar, generar_clips


def barra(pct: float, msg: str) -> None:
    llenos = int(pct / 4)
    sys.stdout.write(f"\r[{'#' * llenos}{'.' * (25 - llenos)}] {pct:5.1f}%  {msg[:50]:<50}")
    sys.stdout.flush()


def main() -> int:
    p = argparse.ArgumentParser(description="Genera clips automáticamente de un vídeo o directo.")
    p.add_argument("fuente", help="Enlace (YouTube, Twitch, Kick, TikTok…) o archivo local")
    p.add_argument("-n", "--cantidad", type=int, default=5, help="Número de clips (por defecto 5)")
    p.add_argument("-d", "--duracion", type=float, default=30, help="Segundos por clip (por defecto 30)")
    p.add_argument("-f", "--formato", choices=list(FORMATOS), default="original")
    p.add_argument("-o", "--salida", default=None, help="Carpeta de salida")
    p.add_argument("--subtitulos", action="store_true", help="Subtítulos automáticos (faster-whisper)")
    p.add_argument("--rapido", action="store_true", help="No analizar cortes de cámara (más rápido)")
    p.add_argument("--directo", type=float, default=10, metavar="MIN",
                   help="Minutos a grabar si el enlace es un directo (por defecto 10)")
    a = p.parse_args()

    salida = a.salida or os.path.join("clips", time.strftime("%Y%m%d_%H%M%S"))
    t0 = time.time()
    try:
        info = None
        fuente = a.fuente
        if not os.path.isfile(fuente):
            fuente, info = descargar(a.fuente, os.path.join(salida, "fuente"), barra,
                                     minutos_directo=a.directo)
            print()
        r = generar_clips(fuente, salida, a.cantidad, a.duracion, a.formato,
                          a.subtitulos, not a.rapido, info, barra)
    except ClipError as exc:
        print(f"\nError: {exc}")
        return 1
    print(f"\n\n{len(r.clips)} clips de «{r.titulo}» en {time.time() - t0:.0f} s")
    print(f"Señales usadas: {', '.join(r.senales)}")
    for aviso in r.avisos:
        print(f"Aviso: {aviso}")
    for c in r.clips:
        print(f"  {c.archivo}  {c.inicio:7.1f}s → {c.fin:7.1f}s   interés {c.puntuacion}%")
    print(f"Carpeta: {os.path.abspath(salida)}  (todo junto en clips.zip)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
