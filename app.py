"""AutoClips — servidor web local.

Uso:
    python app.py                 # abre http://127.0.0.1:5000
    python app.py --red           # accesible desde el móvil en la misma wifi
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import threading
import time
import traceback
import uuid
import webbrowser

from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from clipper import FORMATOS, ClipError, descargar, generar_clips, subtitulos_disponibles

RAIZ = os.path.dirname(os.path.abspath(__file__))
TRABAJOS = os.path.join(RAIZ, "trabajos")
HORAS_CADUCIDAD = 24

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 ** 3  # subidas de hasta 8 GB

trabajos: dict[str, dict] = {}
cerrojo = threading.Lock()
# Un trabajo pesado a la vez para no saturar el ordenador.
turno = threading.Semaphore(1)


def _actualizar(id_: str, **datos) -> None:
    with cerrojo:
        trabajos[id_].update(datos)


def _procesar(id_: str, opciones: dict) -> None:
    carpeta = os.path.join(TRABAJOS, id_)
    _actualizar(id_, estado="en_cola", mensaje="Esperando turno…")
    with turno:
        try:
            fuente = opciones.get("archivo")
            info = {"title": opciones["titulo"]} if fuente else None
            if not fuente:
                _actualizar(id_, estado="descargando")
                fuente, info = descargar(
                    opciones["url"], os.path.join(carpeta, "fuente"),
                    lambda p, m: _actualizar(id_, progreso=round(p * 0.35, 1), mensaje=m),
                    minutos_directo=opciones["minutos_directo"],
                )
                if info:
                    _actualizar(id_, titulo=info.get("title"))
            _actualizar(id_, estado="analizando")
            resultado = generar_clips(
                fuente, carpeta,
                cantidad=opciones["cantidad"],
                duracion_clip=opciones["duracion"],
                formato=opciones["formato"],
                subtitulos=opciones["subtitulos"],
                analizar_escenas=opciones["escenas"],
                info=info,
                progreso=lambda p, m: _actualizar(id_, progreso=round(35 + p * 0.65, 1), mensaje=m),
            )
            if not opciones.get("conservar"):
                shutil.rmtree(os.path.join(carpeta, "fuente"), ignore_errors=True)
            _actualizar(id_, estado="listo", progreso=100, mensaje="¡Clips listos!",
                        resultado=resultado.a_dict(), titulo=resultado.titulo)
        except ClipError as exc:
            _actualizar(id_, estado="error", mensaje=str(exc))
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            _actualizar(id_, estado="error", mensaje=f"Error inesperado: {exc}")


def _limpiar_antiguos() -> None:
    if not os.path.isdir(TRABAJOS):
        return
    limite = time.time() - HORAS_CADUCIDAD * 3600
    for nombre in os.listdir(TRABAJOS):
        ruta = os.path.join(TRABAJOS, nombre)
        if os.path.isdir(ruta) and os.path.getmtime(ruta) < limite:
            shutil.rmtree(ruta, ignore_errors=True)


def _numero(valor, defecto, minimo, maximo, tipo=float):
    try:
        return max(minimo, min(maximo, tipo(valor)))
    except (TypeError, ValueError):
        return defecto


@app.get("/")
def inicio():
    return render_template("index.html", formatos=FORMATOS, subtitulos=subtitulos_disponibles())


@app.post("/api/trabajos")
def crear_trabajo():
    f = request.form
    url = (f.get("url") or "").strip()
    subida = request.files.get("archivo")
    if not url and not (subida and subida.filename):
        return jsonify(error="Pega un enlace o sube un vídeo."), 400
    if url and not re.match(r"^https?://", url):
        return jsonify(error="El enlace debe empezar por http:// o https://"), 400

    id_ = uuid.uuid4().hex[:12]
    carpeta = os.path.join(TRABAJOS, id_)
    os.makedirs(carpeta, exist_ok=True)

    opciones = {
        "url": url,
        "cantidad": _numero(f.get("cantidad"), 5, 1, 50, int),
        "duracion": _numero(f.get("duracion"), 30, 5, 600),
        "formato": f.get("formato") if f.get("formato") in FORMATOS else "original",
        "subtitulos": f.get("subtitulos") == "on",
        "escenas": f.get("escenas", "on") == "on",
        "minutos_directo": _numero(f.get("minutos_directo"), 10, 1, 240),
    }
    titulo = url
    if subida and subida.filename:
        nombre = secure_filename(subida.filename) or "video.mp4"
        ruta = os.path.join(carpeta, "subida_" + nombre)
        subida.save(ruta)
        opciones["archivo"] = ruta
        opciones["url"] = ""
        titulo = subida.filename
    opciones["titulo"] = titulo

    with cerrojo:
        trabajos[id_] = {"id": id_, "estado": "en_cola", "progreso": 0,
                         "mensaje": "En cola…", "titulo": titulo, "resultado": None}
    threading.Thread(target=_procesar, args=(id_, opciones), daemon=True).start()
    return jsonify(id=id_)


@app.get("/api/trabajos/<id_>")
def ver_trabajo(id_: str):
    with cerrojo:
        t = trabajos.get(id_)
        if not t:
            abort(404)
        return jsonify(t)


@app.get("/trabajos/<id_>/<path:archivo>")
def archivo_trabajo(id_: str, archivo: str):
    if not re.fullmatch(r"[0-9a-f]{12}", id_) or not re.fullmatch(r"[\w.-]+", archivo):
        abort(404)
    descarga = request.args.get("descargar") == "1"
    return send_from_directory(os.path.join(TRABAJOS, id_), archivo, as_attachment=descarga)


def main() -> None:
    p = argparse.ArgumentParser(description="AutoClips: genera clips automáticamente.")
    p.add_argument("--puerto", type=int, default=5000)
    p.add_argument("--red", action="store_true",
                   help="Permitir acceso desde otros dispositivos de tu red (móvil).")
    p.add_argument("--sin-navegador", action="store_true", help="No abrir el navegador.")
    a = p.parse_args()

    os.makedirs(TRABAJOS, exist_ok=True)
    _limpiar_antiguos()
    host = "0.0.0.0" if a.red else "127.0.0.1"
    direccion = f"http://127.0.0.1:{a.puerto}"
    print(f"\n  AutoClips funcionando en {direccion}\n  (Ctrl+C para cerrar)\n")
    if not a.sin_navegador:
        threading.Timer(1.2, lambda: webbrowser.open(direccion)).start()
    app.run(host=host, port=a.puerto, threaded=True)


if __name__ == "__main__":
    main()
