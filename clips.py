"""AutoClips desde la terminal.

Ejemplos:
    python clips.py "https://www.twitch.tv/videos/123456789" -n 10 --estilo graciosos
    python clips.py "https://www.youtube.com/watch?v=XXXX" -n 5 -d 30
    python clips.py "https://www.twitch.tv/canal" --directo 15 -n 3
    python clips.py mi_video.mp4 -n 8 --subtitulos
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from clipper import ESTILOS, FORMATOS, ClipError, Opciones, procesar


def barra(pct: float, msg: str) -> None:
    llenos = int(pct / 4)
    sys.stdout.write(f"\r[{'#' * llenos}{'.' * (25 - llenos)}] {pct:5.1f}%  {msg[:50]:<50}")
    sys.stdout.flush()


def main() -> int:
    p = argparse.ArgumentParser(description="Saca clips de los mejores momentos de un vídeo o directo.")
    p.add_argument("fuente", help="Enlace (Twitch, YouTube, Kick, TikTok…) o archivo de vídeo")
    p.add_argument("-n", "--cantidad", type=int, default=5, help="Número de clips (por defecto 5)")
    p.add_argument("-d", "--duracion", default="auto",
                   help="Segundos por clip o 'auto' (15-60 s según el momento; por defecto)")
    p.add_argument("-f", "--formato", choices=list(FORMATOS), default="vertical_fondo")
    p.add_argument("-e", "--estilo", choices=list(ESTILOS), default="todo",
                   help="Qué momentos priorizar: todo, graciosos o epicos")
    p.add_argument("-o", "--salida", default=None, help="Carpeta de salida")
    p.add_argument("--subtitulos", action="store_true", help="Subtítulos automáticos")
    p.add_argument("--sin-ia", action="store_true", help="No usar la IA de voz para detectar risas")
    p.add_argument("--sin-chat", action="store_true", help="No leer el chat del stream")
    p.add_argument("--rapido", action="store_true", help="No analizar cortes de cámara")
    p.add_argument("--directo", type=float, default=10, metavar="MIN",
                   help="Minutos a grabar si el enlace es un directo en emisión (por defecto 10)")
    a = p.parse_args()

    op = Opciones(
        cantidad=a.cantidad,
        duracion="auto" if a.duracion == "auto" else float(a.duracion),
        formato=a.formato, estilo=a.estilo, subtitulos=a.subtitulos,
        ia_voz=not a.sin_ia, chat=not a.sin_chat, escenas=not a.rapido,
        minutos_directo=a.directo,
    )
    salida = a.salida or os.path.join("clips", time.strftime("%Y%m%d_%H%M%S"))
    t0 = time.time()
    try:
        r = procesar(a.fuente, salida, op, barra)
    except ClipError as exc:
        print(f"\nError: {exc}")
        return 1
    print(f"\n\n{len(r.clips)} clips de «{r.titulo}» en {time.time() - t0:.0f} s")
    print(f"Analizado con: {', '.join(r.senales)}")
    for aviso in r.avisos:
        print(f"Aviso: {aviso}")
    for c in r.clips:
        print(f"  #{c.numero} {c.archivo}  {c.inicio:8.1f}s → {c.fin:8.1f}s  "
              f"({c.fin - c.inicio:4.0f}s)  {c.puntuacion}%  {c.motivo}")
    print(f"Carpeta: {os.path.abspath(salida)}  (todo junto en clips.zip)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
