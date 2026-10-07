"""Genera clips de prueba con FFmpeg + espeak-ng (voz sintética).

- VID_0001.mp4, VID_0002.mp4, VID_0003.mp4: tres partes de un mismo vídeo (misma escena,
  fechas consecutivas, frase cortada entre clips, silencios, muletillas y una toma repetida).
  Iluminación mala (oscura y azulada) y una cara que se mueve por el plano.
- paisaje_playa.mov: un clip que no tiene nada que ver (otra fecha, otra resolución, otra voz).
- buena_luz.mp4 (opcional, --extra): clip con buena iluminación para comprobar que no se corrige.

Uso: python backend/tools/make_test_clips.py <carpeta_salida> [--extra]
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from skimage import data as skdata
from skimage.io import imsave
from skimage.transform import resize

# Guion: (texto, pausa_después_en_segundos). La toma repetida y las muletillas son intencionadas.
PARTS = [
    [("Hola a todos y bienvenidos al canal.", 1.6),
     ("Hoy os voy a enseñar.", 0.5), ("Hoy os voy a enseñar a editar vídeos con inteligencia artificial.", 0.4),
     ("Eh,", 0.6), ("es mucho más fácil de lo que", 0.0)],
    [("parece, y además es gratis.", 1.8),
     ("Primero subimos los clips y el programa los ordena solo.", 0.4),
     ("Em,", 0.7), ("luego quita los silencios automáticamente.", 0.0)],
    [("Y al final exportamos el vídeo terminado.", 1.5),
     ("Si os ha gustado, dadle a me gusta y suscribíos.", 0.5),
     ("Nos vemos en el próximo vídeo.", 1.0)],
]
OTHER = [("El mar está precioso hoy en la playa.", 0.8), ("Mañana volveremos con más paisajes.", 1.0)]


def sh(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def tts(text, wav, voice="es", speed=150, pitch=50):
    sh(["espeak-ng", "-v", voice, "-s", str(speed), "-p", str(pitch), "-w", str(wav), text])


def speech_track(lines, out_wav, tmp: Path, voice="es"):
    parts = []
    for i, (txt, pause) in enumerate(lines):
        w = tmp / f"{out_wav.stem}_{i}.wav"
        tts(txt, w, voice)
        parts.append(w)
        if pause > 0:
            s = tmp / f"{out_wav.stem}_{i}_sil.wav"
            sh(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", str(pause), s])
            parts.append(s)
    lst = tmp / f"{out_wav.stem}.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-ar", "48000", "-ac", "1", out_wav])
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          out_wav], capture_output=True, text=True)
    return float(out.stdout.strip())


def make_scene_images(tmp: Path):
    bg = skdata.coffee()  # fondo de "habitación"
    bg = (resize(bg, (720, 1280), anti_aliasing=True) * 255).astype(np.uint8)
    imsave(tmp / "bg.png", bg)
    face = skdata.astronaut()[0:300, 120:380]  # retrato con la cara
    imsave(tmp / "face.png", face)
    beach = np.zeros((1080, 1920, 3), np.uint8)
    for y in range(1080):
        beach[y] = (40 + y // 12, 120 + y // 18, 200 - y // 10) if y < 600 else (210, 190, 140)
    imsave(tmp / "beach.png", beach)


def make_part(idx, lines, offset, out: Path, tmp: Path, created: str, dark=True):
    wav = tmp / f"voz{idx}.wav"
    dur = speech_track(lines, wav, tmp)
    # La cara se mueve de forma continua entre clips (usa el tiempo global offset+t)
    x = f"340+220*sin(({offset}+t)*0.35)"
    y = f"200+40*sin(({offset}+t)*0.9)"
    grade = ",eq=brightness=-0.14:gamma=0.72:saturation=0.85,colorchannelmixer=rr=0.80:gg=0.94:bb=1.15" if dark else ""
    sh(["ffmpeg", "-y", "-loop", "1", "-i", tmp / "bg.png", "-loop", "1", "-i", tmp / "face.png", "-i", wav,
        "-filter_complex",
        f"[0:v]scale=1280:720,format=rgb24[b];[1:v]scale=300:-2[f];"
        f"[b][f]overlay=x='{x}':y='{y}':shortest=0,format=yuv420p{grade}[v]",
        "-map", "[v]", "-map", "2:a", "-t", f"{dur:.3f}", "-r", "30", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-metadata", f"creation_time={created}",
        "-metadata", "model=TestPhone X", out])
    return dur


def main():
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "test_clips")
    outdir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        make_scene_images(tmp)
        offset = 0.0
        times = ["2026-05-10T10:00:00Z", None, None]
        from datetime import datetime, timedelta
        start = datetime.fromisoformat("2026-05-10T10:00:00+00:00")
        for i, lines in enumerate(PARTS):
            created = (start + timedelta(seconds=offset + 3 * i)).strftime("%Y-%m-%dT%H:%M:%S.000000Z")
            d = make_part(i, lines, offset, outdir / f"VID_{i + 1:04d}.mp4", tmp, created)
            offset += d
            print(f"VID_{i + 1:04d}.mp4  {d:.1f}s  {created}")
        # clip ajeno
        wav = tmp / "otro.wav"
        dur = speech_track(OTHER, wav, tmp, voice="es+f3")
        sh(["ffmpeg", "-y", "-loop", "1", "-i", tmp / "beach.png", "-i", wav, "-vf",
            "zoompan=z='1+0.0008*on':d=1:s=1920x1080:fps=25,format=yuv420p", "-t", f"{dur:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac",
            "-metadata", "creation_time=2026-02-02T17:30:00.000000Z", outdir / "paisaje_playa.mov"])
        print(f"paisaje_playa.mov  {dur:.1f}s")
        if "--extra" in sys.argv:
            wav = tmp / "buena.wav"
            dur = speech_track([("Este clip tiene buena iluminación.", 0.5)], wav, tmp)
            sh(["ffmpeg", "-y", "-loop", "1", "-i", tmp / "bg.png", "-loop", "1", "-i", tmp / "face.png", "-i", wav,
                "-filter_complex", "[0:v]scale=1280:720[b];[1:v]scale=300:-2[f];[b][f]overlay=490:200,format=yuv420p[v]",
                "-map", "[v]", "-map", "2:a", "-t", f"{dur:.3f}", "-r", "30", "-c:v", "libx264", "-crf", "20",
                "-c:a", "aac", "-metadata", "creation_time=2026-03-03T12:00:00.000000Z", outdir / "buena_luz.mp4"])
            print(f"buena_luz.mp4  {dur:.1f}s")


if __name__ == "__main__":
    main()
