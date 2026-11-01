"""Servidor local (FastAPI) del Estudio de Capas.

Arranque:  python -m engine.server   (o scripts/iniciar.sh)
Escucha solo en 127.0.0.1. Las imágenes se procesan en este equipo; nada se envía fuera
salvo que actives la opción en la nube (NUBE_ACTIVADA=true) y confirmes cada envío.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import queue
import re
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

RAIZ = Path(__file__).resolve().parents[1]
load_dotenv(RAIZ / ".env")

from . import cloud, device, inpaint, layers, segment  # noqa: E402
from . import text as tx  # noqa: E402
from .models import registry  # noqa: E402

logging.basicConfig(level=os.environ.get("ESTUDIO_LOG", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("estudio")

PROYECTOS = Path(os.environ.get("ESTUDIO_PROYECTOS", RAIZ / "projects"))
PROYECTOS.mkdir(parents=True, exist_ok=True)
ASSETS = RAIZ / "assets"
WEB = RAIZ / "web" / "dist"
MAX_SUBIDA = 40 * 1024 * 1024
NOMBRE_OK = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
ID_OK = re.compile(r"^[a-f0-9]{8,32}$")

app = FastAPI(title="Estudio de Capas", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

cerrojo_ia = threading.Lock()  # una operación de IA pesada a la vez (evita quedarse sin memoria)


# ------------------------------------------------------------------ errores

class ErrorUsuario(Exception):
    def __init__(self, mensaje: str, estado: int = 400):
        self.mensaje, self.estado = mensaje, estado


@app.exception_handler(ErrorUsuario)
async def _err_usuario(_: Request, e: ErrorUsuario):
    return JSONResponse({"detalle": e.mensaje}, status_code=e.estado)


@app.exception_handler(layers.ImagenInvalida)
async def _err_imagen(_: Request, e: layers.ImagenInvalida):
    return JSONResponse({"detalle": str(e)}, status_code=422)


@app.exception_handler(segment.ModeloNoDisponible)
async def _err_modelo(_: Request, e: segment.ModeloNoDisponible):
    return JSONResponse({"detalle": str(e)}, status_code=503)


@app.exception_handler(cloud.NubeDesactivada)
async def _err_nube(_: Request, e: cloud.NubeDesactivada):
    return JSONResponse({"detalle": str(e)}, status_code=403)


@app.exception_handler(Exception)
async def _err_general(_: Request, e: Exception):
    log.error("Error no controlado: %s\n%s", e, traceback.format_exc())
    if device.es_falta_de_memoria(e):
        device.liberar_memoria()
        return JSONResponse({"detalle": "Memoria insuficiente. Prueba con una imagen más pequeña."}, status_code=507)
    return JSONResponse({"detalle": "Error interno del motor. Revisa el registro del servidor."}, status_code=500)


# ------------------------------------------------------------------ utilidades

def carpeta_proyecto(pid: str) -> Path:
    if not ID_OK.match(pid):
        raise ErrorUsuario("Identificador de proyecto no válido.", 404)
    return PROYECTOS / pid


def ruta_recurso(pid: str, url_o_nombre: str) -> Path:
    nombre = url_o_nombre.rsplit("/", 1)[-1].split("?")[0]
    if not NOMBRE_OK.match(nombre):
        raise ErrorUsuario("Nombre de recurso no válido.")
    p = carpeta_proyecto(pid) / "recursos" / nombre
    if not p.exists():
        raise ErrorUsuario("No existe el recurso indicado.", 404)
    return p


def url_recurso(pid: str, nombre: str) -> str:
    return f"/api/proyectos/{pid}/recursos/{nombre}"


def almacen(pid: str) -> layers.Almacen:
    return layers.Almacen(carpeta_proyecto(pid) / "recursos", f"/api/proyectos/{pid}/recursos")


def leer_rgba(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGBA"))


def decodificar_data_url(d: str) -> np.ndarray:
    try:
        datos = base64.b64decode(d.split(",", 1)[-1])
        return np.asarray(Image.open(io.BytesIO(datos)).convert("RGBA"))
    except Exception:
        raise ErrorUsuario("La máscara enviada no es una imagen válida.")


def mascara_de(d: str, forma: tuple[int, int]) -> np.ndarray:
    """Máscara booleana a partir de un PNG (píxeles pintados = opacos o claros)."""
    m = decodificar_data_url(d)
    a = (m[..., 3] > 20) & (m[..., :3].max(-1) > 20)
    if a.shape != forma:
        a = cv2.resize(a.astype(np.uint8), (forma[1], forma[0]), interpolation=cv2.INTER_NEAREST) > 0
    return a


async def leer_subida(archivo: UploadFile) -> bytes:
    datos = await archivo.read(MAX_SUBIDA + 1)
    if len(datos) > MAX_SUBIDA:
        raise ErrorUsuario(f"El archivo supera el máximo de {MAX_SUBIDA // (1024 * 1024)} MB.", 413)
    return datos


def guardar_proyecto(pid: str, datos: dict) -> None:
    c = carpeta_proyecto(pid)
    c.mkdir(parents=True, exist_ok=True)
    datos["id"] = pid
    datos["updatedAt"] = time.time()
    layers.guardar_json(c / "proyecto.json", datos)


# ------------------------------------------------------------------ estado y recursos

@app.get("/api/estado")
def estado():
    return {"version": app.version, "dispositivo": device.info(), "modelos": registry.estado(),
            "nube": {**cloud.config()}, "local": True}


@app.get("/api/fuentes")
def fuentes():
    return tx.manifiesto_web()


@app.get("/api/recursos-libres")
def recursos_libres():
    """Formas, texturas y superposiciones incluidas (con su licencia en assets/LICENSES.md)."""
    out = {}
    for tipo in ("overlays", "textures", "shapes"):
        d = ASSETS / tipo
        out[tipo] = sorted(f"/assets/{tipo}/{p.name}" for p in d.glob("*") if p.suffix.lower() in {".png", ".jpg", ".webp", ".svg"}) if d.exists() else []
    return out


# ------------------------------------------------------------------ proyectos

class DatosProyecto(BaseModel):
    model_config = {"extra": "allow"}
    name: str = "Sin título"
    width: int = Field(1280, ge=16, le=10000)
    height: int = Field(720, ge=16, le=10000)
    layers: list = []


@app.get("/api/proyectos")
def listar_proyectos():
    out = []
    for c in PROYECTOS.iterdir():
        p = c / "proyecto.json"
        if not c.is_dir() or not p.exists():
            continue
        try:
            d = json.loads(p.read_text("utf-8"))
        except Exception:
            continue
        out.append({"id": c.name, "name": d.get("name", "Sin título"), "updatedAt": d.get("updatedAt", 0),
                    "width": d.get("width"), "height": d.get("height"),
                    "thumbnail": url_recurso(c.name, "miniatura.jpg") if (c / "recursos" / "miniatura.jpg").exists() else None})
    out.sort(key=lambda x: -x["updatedAt"])
    return out


@app.post("/api/proyectos")
def crear_proyecto(datos: DatosProyecto):
    pid = uuid.uuid4().hex[:16]
    d = datos.model_dump()
    d.setdefault("version", 1)
    d["createdAt"] = time.time()
    (carpeta_proyecto(pid) / "recursos").mkdir(parents=True, exist_ok=True)
    guardar_proyecto(pid, d)
    return d


@app.get("/api/proyectos/{pid}")
def leer_proyecto(pid: str):
    p = carpeta_proyecto(pid) / "proyecto.json"
    if not p.exists():
        raise ErrorUsuario("Ese proyecto no existe.", 404)
    return json.loads(p.read_text("utf-8"))


@app.put("/api/proyectos/{pid}")
def actualizar_proyecto(pid: str, datos: DatosProyecto):
    if not (carpeta_proyecto(pid) / "proyecto.json").exists():
        raise ErrorUsuario("Ese proyecto no existe.", 404)
    d = datos.model_dump()
    guardar_proyecto(pid, d)
    return {"ok": True, "updatedAt": d["updatedAt"]}


@app.delete("/api/proyectos/{pid}")
def borrar_proyecto(pid: str):
    c = carpeta_proyecto(pid)
    if c.exists():
        shutil.rmtree(c)
    return {"ok": True}


@app.post("/api/proyectos/{pid}/recursos")
async def subir_recurso(pid: str, archivo: UploadFile = File(...)):
    c = carpeta_proyecto(pid)
    if not c.exists():
        raise ErrorUsuario("Ese proyecto no existe.", 404)
    datos = await leer_subida(archivo)
    try:
        im = Image.open(io.BytesIO(datos))
        im.load()
    except Exception:
        raise ErrorUsuario("El archivo no es una imagen válida o está dañado.", 422)
    if im.width * im.height > layers.MAX_MEGAPIXELES * 1_000_000:
        raise ErrorUsuario("La imagen es demasiado grande.", 413)
    nombre = f"{uuid.uuid4().hex[:10]}.png"
    (c / "recursos").mkdir(exist_ok=True)
    im.convert("RGBA").save(c / "recursos" / nombre, compress_level=4)
    return {"url": url_recurso(pid, nombre), "width": im.width, "height": im.height}


FUENTE_OK = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}


@app.post("/api/proyectos/{pid}/fuentes")
async def subir_fuente(pid: str, archivo: UploadFile = File(...)):
    """Fuente propia del usuario (se guarda dentro del proyecto)."""
    c = carpeta_proyecto(pid)
    if not c.exists():
        raise ErrorUsuario("Ese proyecto no existe.", 404)
    ext = Path(archivo.filename or "").suffix.lower()
    if ext not in FUENTE_OK:
        raise ErrorUsuario("Formato de fuente no admitido. Usa .ttf, .otf, .woff o .woff2.", 415)
    datos = await leer_subida(archivo)
    firmas = (b"\x00\x01\x00\x00", b"OTTO", b"true", b"wOFF", b"wOF2")
    if not datos[:4] in firmas:
        raise ErrorUsuario("El archivo no parece una fuente válida.", 422)
    familia = re.sub(r"[^A-Za-z0-9 ]+", " ", Path(archivo.filename or "Fuente").stem).strip()[:40] or "Fuente propia"
    nombre = f"fuente_{uuid.uuid4().hex[:8]}{ext}"
    (c / "recursos").mkdir(exist_ok=True)
    (c / "recursos" / nombre).write_bytes(datos)
    return {"url": url_recurso(pid, nombre), "familia": f"{familia} (propia)"}


@app.post("/api/proyectos/{pid}/miniatura")
async def subir_miniatura(pid: str, archivo: UploadFile = File(...)):
    c = carpeta_proyecto(pid)
    datos = await leer_subida(archivo)
    im = Image.open(io.BytesIO(datos)).convert("RGB")
    im.thumbnail((480, 480))
    (c / "recursos").mkdir(parents=True, exist_ok=True)
    im.save(c / "recursos" / "miniatura.jpg", quality=80)
    return {"ok": True}


@app.get("/api/proyectos/{pid}/recursos/{nombre}")
def leer_recurso(pid: str, nombre: str):
    return FileResponse(ruta_recurso(pid, nombre), headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ------------------------------------------------------------------ descomposición (trabajos)

TRABAJOS: dict[str, dict] = {}
COLA: "queue.Queue[tuple[str, str, np.ndarray, str]]" = queue.Queue()


def _trabajador():
    while True:
        tid, pid, img, nombre = COLA.get()
        t = TRABAJOS[tid]
        t["estado"] = "procesando"

        def prog(p, msg):
            t["progreso"], t["mensaje"] = round(p, 3), msg

        try:
            with cerrojo_ia:
                res = layers.descomponer(img, almacen(pid), prog)
            proyecto = res.proyecto
            proyecto["name"] = nombre
            proyecto["createdAt"] = time.time()
            guardar_proyecto(pid, proyecto)
            t.update(estado="listo", progreso=1.0, mensaje="Listo", proyecto=proyecto)
        except Exception as e:
            log.error("Fallo en la descomposición: %s\n%s", e, traceback.format_exc())
            msg = "No se pudo descomponer la imagen."
            if device.es_falta_de_memoria(e):
                device.liberar_memoria()
                msg = "Memoria insuficiente para descomponer esta imagen. Prueba con una más pequeña."
            elif isinstance(e, segment.ModeloNoDisponible):
                msg = str(e)
            t.update(estado="error", mensaje=msg)
        finally:
            COLA.task_done()


threading.Thread(target=_trabajador, daemon=True, name="descomposicion").start()


@app.post("/api/descomponer")
async def descomponer(archivo: UploadFile = File(...), nombre: str = Form("")):
    datos = await leer_subida(archivo)
    img, avisos = layers.cargar_imagen(datos)
    pid = uuid.uuid4().hex[:16]
    (carpeta_proyecto(pid) / "recursos").mkdir(parents=True, exist_ok=True)
    tid = uuid.uuid4().hex[:12]
    nombre = (nombre or Path(archivo.filename or "imagen").stem)[:80]
    TRABAJOS[tid] = {"id": tid, "proyecto_id": pid, "estado": "en_cola", "progreso": 0.0,
                     "mensaje": "En cola…", "avisos": avisos, "proyecto": None}
    COLA.put((tid, pid, img, nombre))
    return {"trabajo": tid, "proyecto": pid, "avisos": avisos}


@app.get("/api/trabajos/{tid}")
def trabajo(tid: str):
    t = TRABAJOS.get(tid)
    if not t:
        raise ErrorUsuario("Trabajo no encontrado.", 404)
    return t


# ------------------------------------------------------------------ herramientas de IA

class PeticionRecurso(BaseModel):
    proyecto: str
    recurso: str


class PeticionSegmentar(PeticionRecurso):
    puntos: list[dict] = []  # [{x, y, positivo}] en píxeles del recurso
    caja: list[float] | None = None
    mascara: str | None = None  # PNG (data URL) pintado con el pincel
    quitar_del_origen: bool = False


class PeticionBorrar(PeticionRecurso):
    mascara: str


@app.post("/api/ia/quitar-fondo")
def ia_quitar_fondo(p: PeticionRecurso):
    rgba = leer_rgba(ruta_recurso(p.proyecto, p.recurso))
    with cerrojo_ia:
        rec = segment.quitar_fondo(np.ascontiguousarray(rgba[..., :3]))
    rec[..., 3] = np.minimum(rec[..., 3], rgba[..., 3])
    r = segment.rgba_recortado(rec[..., :3], rec[..., 3].astype(np.float32) / 255)
    if r is None:
        raise ErrorUsuario("No se encontró ningún sujeto en la imagen.", 422)
    out, (x, y) = r
    url = almacen(p.proyecto).guardar(out)
    return {"url": url, "x": x, "y": y, "width": out.shape[1], "height": out.shape[0], "avisos": list(segment.AVISOS)}


@app.post("/api/ia/segmentar")
def ia_segmentar(p: PeticionSegmentar):
    """Rehace la segmentación de una zona: clics (positivos/negativos), caja o pincel.
    Devuelve la nueva capa recortada y, si se pide, el recurso de origen con la zona rellenada."""
    ruta = ruta_recurso(p.proyecto, p.recurso)
    rgba = leer_rgba(ruta)
    rgb = np.ascontiguousarray(rgba[..., :3])
    H, W = rgb.shape[:2]
    if p.mascara:
        m = mascara_de(p.mascara, (H, W))
        if not m.any():
            raise ErrorUsuario("No has pintado ninguna zona.")
        conf = 0.9
        if p.puntos or p.caja:
            pass
        with cerrojo_ia:
            alfa = segment.afinar_alfa(rgb, m, banda=4)
    else:
        if not p.puntos and not p.caja:
            raise ErrorUsuario("Haz clic sobre el objeto o dibuja una caja.")
        pts = [(float(q["x"]), float(q["y"])) for q in p.puntos]
        etq = [1 if q.get("positivo", True) else 0 for q in p.puntos]
        with cerrojo_ia:
            res = segment.sam_mascaras(rgb, cajas=[tuple(p.caja)] if p.caja else None, puntos=pts or None, etiquetas=etq or None)
            if not res:
                raise ErrorUsuario("No se pudo segmentar esa zona.", 422)
            m, conf = res[0]
            m = segment.limpiar_mascara(m)
            alfa = segment.afinar_alfa(rgb, m)
    alfa = alfa * (rgba[..., 3].astype(np.float32) / 255)
    r = segment.rgba_recortado(rgb, alfa)
    if r is None:
        raise ErrorUsuario("La zona seleccionada está vacía.", 422)
    out, (x, y) = r
    alm = almacen(p.proyecto)
    resp = {"capa": {"src": alm.guardar(out), "x": x, "y": y, "width": out.shape[1], "height": out.shape[0],
                     "confidence": round(float(conf), 3)}}
    if p.quitar_del_origen:
        hueco = cv2.dilate((alfa > 0.03).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        with cerrojo_ia:
            relleno = inpaint.rellenar(rgb, hueco)
        nuevo = np.dstack([relleno, rgba[..., 3]])
        resp["origen"] = alm.guardar(nuevo)
    resp["avisos"] = list(segment.AVISOS) + list(inpaint.AVISOS)
    return resp


@app.post("/api/ia/borrar")
def ia_borrar(p: PeticionBorrar):
    """Borrar objeto con IA: rellena la zona pintada. En capas recortadas conserva la transparencia."""
    rgba = leer_rgba(ruta_recurso(p.proyecto, p.recurso))
    rgb = np.ascontiguousarray(rgba[..., :3])
    m = mascara_de(p.mascara, rgb.shape[:2])
    if not m.any():
        raise ErrorUsuario("No has pintado ninguna zona.")
    opaco = rgba[..., 3] > 0
    if (opaco.mean() < 0.999):  # capa recortada: lo pintado fuera del sujeto no cuenta
        m &= cv2.dilate(opaco.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    inpaint.AVISOS.clear()
    with cerrojo_ia:
        res = inpaint.rellenar(rgb, m, dilatar=3)
    alfa = rgba[..., 3].copy()
    if opaco.mean() < 0.999:
        # en recortes, lo borrado que tocaba el borde del sujeto pasa a ser transparente
        borde = m & ~(cv2.erode(opaco.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0)
        alfa[borde] = 0
    url = almacen(p.proyecto).guardar(np.dstack([res, alfa]))
    return {"url": url, "avisos": list(inpaint.AVISOS)}


@app.post("/api/ia/dividir")
def ia_dividir(p: PeticionRecurso):
    """Divide una capa de imagen en sus partes separadas (componentes conectados)."""
    rgba = leer_rgba(ruta_recurso(p.proyecto, p.recurso))
    a = (rgba[..., 3] > 10).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(a, np.ones((5, 5), np.uint8)), 8)
    partes = []
    area_min = max(30, int(a.sum() * 0.01))
    alm = almacen(p.proyecto)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < area_min:
            continue
        x, y, w, h = st[i, 0], st[i, 1], st[i, 2], st[i, 3]
        sub = rgba[y:y + h, x:x + w].copy()
        sub[..., 3] = np.where(lab[y:y + h, x:x + w] == i, sub[..., 3], 0)
        partes.append({"url": alm.guardar(sub), "x": int(x), "y": int(y), "width": int(w), "height": int(h)})
    if len(partes) < 2:
        raise ErrorUsuario("Esta capa no tiene partes separadas que dividir. Usa la herramienta de segmentar para recortar una zona.", 422)
    return {"partes": partes}


@app.post("/api/ia/optimizar-png")
async def optimizar_png(archivo: UploadFile = File(...), max_bytes: int = Form(...)):
    """Reduce colores de un PNG hasta que quepa en `max_bytes` (para respetar el peso máximo)."""
    datos = await leer_subida(archivo)
    im = Image.open(io.BytesIO(datos)).convert("RGBA")
    if len(datos) <= max_bytes:
        return Response(datos, media_type="image/png", headers={"X-Colores": "original"})
    for colores in (256, 192, 128, 96, 64, 48, 32):
        b = io.BytesIO()
        im.quantize(colores, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(b, "PNG", optimize=True)
        if b.tell() <= max_bytes:
            return Response(b.getvalue(), media_type="image/png", headers={"X-Colores": str(colores)})
    raise ErrorUsuario("Ni reduciendo colores cabe en el peso máximo. Exporta en JPG o WebP.", 422)


# ------------------------------------------------------------------ nube (opcional)

class PeticionNube(PeticionRecurso):
    prompt: str = Field(..., min_length=3, max_length=4000)
    mascara: str | None = None
    ampliar: dict | None = None  # {izquierda, derecha, arriba, abajo} en píxeles
    confirmado: bool = False


@app.get("/api/nube")
def nube_info(width: int = 1024, height: int = 1024):
    return {**cloud.config(), "coste": cloud.coste(width, height),
            "aviso": "La imagen se enviará a los servidores de OpenAI. Solo se hace si lo activas y confirmas."}


@app.post("/api/nube/relleno-generativo")
def nube_relleno(p: PeticionNube):
    rgba = leer_rgba(ruta_recurso(p.proyecto, p.recurso))
    rgb = np.ascontiguousarray(rgba[..., :3])
    mascara = mascara_de(p.mascara, rgb.shape[:2]) if p.mascara else None
    if p.ampliar:
        iz, de, ar, ab = (max(0, int(p.ampliar.get(k, 0))) for k in ("izquierda", "derecha", "arriba", "abajo"))
        rgb = cv2.copyMakeBorder(rgb, ar, ab, iz, de, cv2.BORDER_REPLICATE)
        mascara = np.zeros(rgb.shape[:2], bool)
        mascara[:ar, :] = mascara[rgb.shape[0] - ab:, :] = True
        mascara[:, :iz] = mascara[:, rgb.shape[1] - de:] = True
    out = cloud.relleno_generativo(rgb, mascara, p.prompt, p.confirmado)
    alfa = np.full(out.shape[:2], 255, np.uint8) if p.ampliar or mascara is None else rgba[..., 3]
    url = almacen(p.proyecto).guardar(np.dstack([out, alfa]))
    return {"url": url, "width": out.shape[1], "height": out.shape[0]}


# ------------------------------------------------------------------ estáticos

app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")
if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


def _abrir_navegador_cuando_este_listo(puerto: int) -> None:
    """Abre el navegador solo cuando el servidor ya responde (evita «conexión rechazada»)."""
    import socket
    import webbrowser

    for _ in range(240):
        try:
            with socket.create_connection(("127.0.0.1", puerto), timeout=1):
                webbrowser.open(f"http://127.0.0.1:{puerto}")
                return
        except OSError:
            time.sleep(0.5)


def main():
    import uvicorn

    puerto = int(os.environ.get("ESTUDIO_PUERTO", "8000"))
    log.info("Dispositivo: %s", device.info())
    log.info("Abre http://127.0.0.1:%d en el navegador", puerto)
    if os.environ.get("ESTUDIO_ABRIR_NAVEGADOR") == "1":
        threading.Thread(target=_abrir_navegador_cuando_este_listo, args=(puerto,), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=puerto, log_level="warning")


if __name__ == "__main__":
    main()
