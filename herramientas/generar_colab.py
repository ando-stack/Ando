"""Genera AutoClips_Colab.ipynb con todo el código dentro (no necesita GitHub).

Uso:  python herramientas/generar_colab.py
"""

from __future__ import annotations

import glob
import json
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVOS = ["app.py", "clips.py", "templates/index.html", *sorted(
    os.path.relpath(p, RAIZ) for p in glob.glob(os.path.join(RAIZ, "clipper", "*.py")))]


def celda_md(texto: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": texto.strip("\n").splitlines(True)}


def celda_codigo(codigo: str) -> dict:
    return {"cell_type": "code", "metadata": {"cellView": "form"}, "execution_count": None,
            "outputs": [], "source": codigo.strip("\n").splitlines(True)}


INTRO = """
# ✂️ AutoClips — sin instalar nada

Saca los **momentos graciosos y épicos** de un directo (o un directo resubido de Twitch) y te
los da listos para TikTok. Funciona desde el **navegador del móvil o del PC**, gratis, en los
ordenadores de Google.

### Cómo se usa
1. Pulsa **▶** en el paso **1** y espera a que salga ✅ (1–2 minutos).
2. Pulsa **▶** en el paso **2** y toca el botón **Abrir AutoClips**.
3. Pega el enlace, elige cuántos clips quieres y pulsa **Sacar clips**. Descárgalos al terminar.

💡 *Opcional, más rápido:* menú **Entorno de ejecución → Cambiar tipo de entorno → GPU T4**
antes del paso 1 (la IA que detecta risas va mucho más rápida).

⚠️ Deja esta pestaña abierta mientras trabaja. Si Google desconecta la sesión, vuelve a pulsar ▶ en 1 y 2.
"""

PREPARAR = '''
#@title 1️⃣ Preparar AutoClips (pulsa ▶ y espera a que salga ✅)
import os, subprocess, sys
CODIGO = __CODIGO__
DESTINO = "/content/AutoClips"
for ruta, contenido in CODIGO.items():
    completa = os.path.join(DESTINO, ruta)
    os.makedirs(os.path.dirname(completa), exist_ok=True)
    with open(completa, "w", encoding="utf-8") as f:
        f.write(contenido)
print("Instalando herramientas gratuitas (1-2 minutos)…")
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "yt-dlp[default]",
                "flask", "faster-whisper"], check=False)
if subprocess.run(["which", "ffmpeg"], capture_output=True).returncode != 0:
    subprocess.run("apt-get -qq install -y ffmpeg > /dev/null", shell=True)
os.chdir(DESTINO)
if DESTINO not in sys.path:
    sys.path.insert(0, DESTINO)
print("✅ Listo. Ahora pulsa ▶ en el paso 2.")
'''

ABRIR = '''
#@title 2️⃣ Abrir AutoClips (pulsa ▶ y toca el botón)
import os, threading, time
from IPython.display import HTML, display
import app as autoclips

os.makedirs(autoclips.TRABAJOS, exist_ok=True)
if not globals().get("_servidor_autoclips"):
    _servidor_autoclips = threading.Thread(
        target=lambda: autoclips.app.run(host="127.0.0.1", port=5000, threaded=True), daemon=True)
    _servidor_autoclips.start()
    time.sleep(2)

from google.colab.output import eval_js
enlace = eval_js("google.colab.kernel.proxyPort(5000)")
display(HTML(f"""
<a href="{enlace}" target="_blank" style="display:inline-block;padding:16px 28px;border-radius:12px;
   background:linear-gradient(90deg,#ff4d6d,#ff8a3d);color:#fff;font:700 20px system-ui;text-decoration:none">
   🎬 Abrir AutoClips</a>
<p style="font:14px system-ui">Se abre en otra pestaña. No cierres esta.</p>
"""))
'''

FORMULARIO = '''
#@title 🅱️ (Alternativa) Sacar clips desde aquí, sin abrir otra pestaña
enlace = "" #@param {type:"string"}
cantidad = 5 #@param {type:"slider", min:1, max:30, step:1}
duracion = "auto" #@param ["auto", "15", "20", "30", "45", "60", "90"]
estilo = "todo" #@param ["todo", "graciosos", "epicos"]
formato = "vertical_fondo" #@param ["vertical_fondo", "vertical", "original"]
subtitulos = False #@param {type:"boolean"}
detectar_risas_con_ia = True #@param {type:"boolean"}
minutos_si_es_directo = 10 #@param {type:"integer"}
guardar_en_google_drive = False #@param {type:"boolean"}

import os, shutil, sys, time
from IPython.display import HTML, display
from clipper import ClipError, Opciones, procesar

if not enlace.strip():
    raise SystemExit("Pega un enlace en el campo 'enlace' y vuelve a pulsar ▶")
carpeta = f"/content/clips/{time.strftime('%Y%m%d_%H%M%S')}"

def progreso(p, m):
    sys.stdout.write(f"\\r{p:5.1f}%  {m[:60]:<60}")
    sys.stdout.flush()

try:
    r = procesar(enlace.strip(), carpeta, Opciones(
        cantidad=cantidad, duracion=duracion, estilo=estilo, formato=formato,
        subtitulos=subtitulos, ia_voz=detectar_risas_con_ia,
        minutos_directo=minutos_si_es_directo), progreso)
except ClipError as e:
    raise SystemExit(f"\\n❌ {e}")

print(f"\\n\\n✅ {len(r.clips)} clips de «{r.titulo}» · analizado con: {', '.join(r.senales)}")
for a in r.avisos:
    print("⚠️", a)
for c in r.clips:
    print(f"#{c.numero}  {c.fin - c.inicio:.0f}s  🔥{c.puntuacion}%  {c.motivo}")
if guardar_en_google_drive:
    from google.colab import drive
    drive.mount("/content/drive")
    destino = "/content/drive/MyDrive/AutoClips/" + os.path.basename(carpeta)
    shutil.copytree(carpeta, destino, ignore=shutil.ignore_patterns("fuente"))
    print("📁 Guardados en Google Drive:", destino)
from google.colab import files
files.download(os.path.join(carpeta, "clips.zip"))
'''


def main() -> None:
    codigo = {}
    for ruta in ARCHIVOS:
        with open(os.path.join(RAIZ, ruta), encoding="utf-8") as f:
            codigo[ruta] = f.read()
    preparar = PREPARAR.replace("__CODIGO__", json.dumps(codigo, ensure_ascii=False, indent=0))
    cuaderno = {
        "nbformat": 4, "nbformat_minor": 0,
        "metadata": {"colab": {"provenance": [], "name": "AutoClips"},
                     "kernelspec": {"name": "python3", "display_name": "Python 3"}},
        "cells": [celda_md(INTRO), celda_codigo(preparar), celda_codigo(ABRIR),
                  celda_md("---\n¿Prefieres no abrir otra pestaña? Rellena esto y pulsa ▶:"),
                  celda_codigo(FORMULARIO)],
    }
    salida = os.path.join(RAIZ, "AutoClips_Colab.ipynb")
    with open(salida, "w", encoding="utf-8") as f:
        json.dump(cuaderno, f, ensure_ascii=False, indent=1)
    print(f"Generado {salida} ({len(codigo)} archivos dentro)")


if __name__ == "__main__":
    main()
