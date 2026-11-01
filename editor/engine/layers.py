"""Descomposición de una imagen en capas editables.

Orden del proceso:
 1. Textos: OCR + estilo + fuente parecida (capas de texto editables).
 2. Se borran los textos con relleno inteligente → imagen «limpia».
 3. Sujetos/objetos sobre la imagen limpia: RT-DETRv2 → SAM 2.1 → ViTMatte, más BiRefNet
    para lo que el detector no conoce.
 4. Elementos gráficos planos (bandas, formas de color) por color y forma.
 5. Fondo reconstruido sin sujetos ni gráficos (LaMa).
 6. Capa original bloqueada y oculta como referencia, y comparación de la reconstrucción.
"""
from __future__ import annotations

import io
import json
import logging
import math
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import inpaint, segment
from . import text as tx

log = logging.getLogger("estudio")

MAX_LADO_TRABAJO = 2048
MAX_MEGAPIXELES = 50
FORMATOS = {"JPEG", "PNG", "WEBP"}

Progreso = Callable[[float, str], None]


class ImagenInvalida(ValueError):
    pass


def nuevo_id() -> str:
    return uuid.uuid4().hex[:10]


# ------------------------------------------------------------------ carga

def cargar_imagen(datos: bytes) -> tuple[np.ndarray, list[str]]:
    """Valida y carga una imagen JPG/PNG/WebP. Devuelve RGB uint8 y avisos."""
    avisos = []
    if not datos:
        raise ImagenInvalida("El archivo está vacío.")
    try:
        Image.MAX_IMAGE_PIXELS = MAX_MEGAPIXELES * 1_000_000
        im = Image.open(io.BytesIO(datos))
        formato = im.format
        im.load()
    except Image.DecompressionBombError:
        raise ImagenInvalida(f"La imagen es demasiado grande (máximo {MAX_MEGAPIXELES} megapíxeles).")
    except Exception:
        raise ImagenInvalida("No se puede leer la imagen: el archivo está dañado o no es una imagen.")
    if formato not in FORMATOS:
        raise ImagenInvalida(f"Formato no admitido ({formato}). Usa JPG, PNG o WebP.")
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        fondo = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(fondo, im)
    im = im.convert("RGB")
    if min(im.size) < 32:
        raise ImagenInvalida("La imagen es demasiado pequeña (mínimo 32 píxeles por lado).")
    if max(im.size) > MAX_LADO_TRABAJO:
        f = MAX_LADO_TRABAJO / max(im.size)
        im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
        avisos.append(f"La imagen se ha reducido a {im.width}×{im.height} px para procesarla.")
    return np.asarray(im).copy(), avisos


# ------------------------------------------------------------------ capas

def capa_base(tipo: str, nombre: str, rol: str, x: float, y: float, w: float, h: float, **extra) -> dict:
    c = {
        "id": nuevo_id(),
        "type": tipo,
        "name": nombre,
        "role": rol,
        "x": round(float(x), 2),
        "y": round(float(y), 2),
        "width": round(float(w), 2),
        "height": round(float(h), 2),
        "rotation": 0,
        "scaleX": 1,
        "scaleY": 1,
        "opacity": 1,
        "blendMode": "source-over",
        "visible": True,
        "locked": False,
        "confidence": None,
        "warnings": [],
    }
    c.update(extra)
    return c


def efectos_vacios() -> dict:
    return {
        "outline": {"enabled": False, "color": "#ffffff", "width": 12},
        "glow": {"enabled": False, "color": "#ffffff", "blur": 25, "strength": 0.8},
        "shadow": {"enabled": False, "color": "#000000", "blur": 20, "offsetX": 8, "offsetY": 8, "opacity": 0.6},
    }


def ajustes_vacios() -> dict:
    return {"brightness": 0, "contrast": 0, "saturation": 0, "temperature": 0, "sharpen": 0, "blur": 0, "filter": "none"}


def capa_imagen(nombre: str, rol: str, src: str, x: float, y: float, w: float, h: float, **extra) -> dict:
    return capa_base("image", nombre, rol, x, y, w, h, src=src, maskSrc=None,
                     adjustments=ajustes_vacios(), effects=efectos_vacios(), **extra)


def capa_texto(e: tx.EstiloTexto, h_img: int) -> dict:
    trazos = [{"color": c["color"], "width": c["ancho"]} for c in e.contornos]
    relleno = {"type": "solid", "color": e.relleno, "gradient": {"colors": [e.relleno, e.relleno], "angle": 90}}
    if e.degradado:
        relleno = {"type": "linear", "color": e.degradado[0], "gradient": {"colors": e.degradado, "angle": 90}}
    sombra = {"enabled": False, "color": "#000000", "blur": 0, "offsetX": 6, "offsetY": 6, "opacity": 1}
    if e.sombra:
        sombra = {"enabled": True, "color": e.sombra["color"], "blur": e.sombra["desenfoque"],
                  "offsetX": e.sombra["dx"], "offsetY": e.sombra["dy"], "opacity": e.sombra["opacidad"]}
    c = capa_base(
        "text", f"Texto: {e.texto[:24]}", "texto",
        e.caja_tinta["x"], e.caja_tinta["y"], e.caja_tinta["w"], e.caja_tinta["h"],
        text=e.texto,
        fontFamily=e.familia,
        fontWeight=e.peso,
        fontSize=round(e.tam_fuente, 1),
        letterSpacing=round(e.espaciado, 2),
        lineHeight=1.0,
        align="left",
        fill=relleno,
        strokes=trazos,
        shadow=sombra,
        glow={"enabled": False, "color": "#ffffff", "blur": 20, "strength": 0.8},
        extrude={"enabled": False, "depth": 8, "color": "#000000", "angle": 45},
        skewX=0,
        curve=0,
        fontCandidates=e.fuentes,
        inkBox=dict(e.caja_tinta),
        needsFit=True,
    )
    c["rotation"] = round(e.angulo, 2)
    c["confidence"] = round(0.5 * e.puntuacion_ocr + 0.5 * e.fidelidad, 3)
    c["fidelity"] = e.fidelidad
    return c


# ------------------------------------------------------------------ resultado

@dataclass
class Resultado:
    proyecto: dict
    metricas: dict
    avisos: list[str] = field(default_factory=list)


class Almacen:
    """Guarda los PNG de las capas en la carpeta de recursos del proyecto."""

    def __init__(self, carpeta: Path, prefijo_url: str):
        self.carpeta = carpeta
        self.carpeta.mkdir(parents=True, exist_ok=True)
        self.prefijo = prefijo_url.rstrip("/")

    def guardar(self, arr: np.ndarray, nombre: str | None = None, formato: str = "png") -> str:
        nombre = nombre or f"{nuevo_id()}.{formato}"
        im = Image.fromarray(arr)
        if formato == "jpg":
            im.convert("RGB").save(self.carpeta / nombre, quality=92)
        else:
            im.save(self.carpeta / nombre, optimize=False, compress_level=4)
        return f"{self.prefijo}/{nombre}"


# ------------------------------------------------------------------ gráficos planos

def detectar_graficos(img: np.ndarray, excluir: np.ndarray, max_capas: int = 6) -> list[tuple[np.ndarray, float, str]]:
    """Regiones de color plano con forma compacta (bandas, rectángulos, círculos, insignias).
    Devuelve [(mascara, confianza, nombre)]."""
    H, W = img.shape[:2]
    esc = min(1.0, 640 / max(H, W))
    peq = cv2.resize(img, (int(W * esc), int(H * esc)), interpolation=cv2.INTER_AREA) if esc < 1 else img
    exc = cv2.resize(excluir.astype(np.uint8), (peq.shape[1], peq.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    lab = cv2.cvtColor(peq, cv2.COLOR_RGB2LAB).astype(np.float32)
    # desviación local: las zonas planas tienen muy poca variación
    media = cv2.blur(lab, (5, 5))
    var = cv2.blur((lab - media) ** 2, (5, 5)).sum(-1)
    plano = (var < 18) & ~exc
    datos = lab[plano].reshape(-1, 3)
    if len(datos) < 500:
        return []
    k = 8
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    cv2.setRNGSeed(1)
    idx = np.random.default_rng(1).choice(len(datos), size=min(len(datos), 30000), replace=False)
    _, _, centros = cv2.kmeans(datos[idx], k, None, crit, 2, cv2.KMEANS_PP_CENTERS)
    dist = ((lab[:, :, None, :] - centros[None, None]) ** 2).sum(-1)
    et = dist.argmin(-1)
    dmin = np.sqrt(dist.min(-1))
    area_img = peq.shape[0] * peq.shape[1]
    res = []
    for c in range(k):
        m = ((et == c) & (dmin < 16) & ~exc).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        n, labs, st, _ = cv2.connectedComponentsWithStats(m, 8)
        for i in range(1, n):
            x, y, w, h, a = st[i]
            frac = a / area_img
            if frac < 0.004 or frac > 0.35:
                continue
            comp = labs == i
            bordes = (x == 0) + (y == 0) + (x + w >= peq.shape[1]) + (y + h >= peq.shape[0])
            rect = a / max(1, w * h)
            if bordes >= 4 or (bordes == 3 and not (rect > 0.9 and frac < 0.35)):
                continue
            cnts, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            hull = cv2.convexHull(np.vstack(cnts))
            solidez = a / max(1.0, cv2.contourArea(hull))
            if solidez < 0.8:
                continue
            # la región debe ser realmente plana en la imagen (no un trozo de foto)
            sd = float(np.sqrt(var[comp].mean()))
            if sd > 3.2:
                continue
            nucleo = cv2.erode(comp.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
            if nucleo.sum() < 20:
                continue
            dispersion = float(np.linalg.norm(lab[nucleo] - np.median(lab[nucleo], 0), axis=1).mean())
            if dispersion > 3.5:  # degradados suaves de una foto (cielo, desenfoque): no es un gráfico
                continue
            # forma regular (pocos vértices o casi circular) y bordes nítidos
            perim = sum(cv2.arcLength(c_, True) for c_ in cnts)
            circ = 4 * math.pi * a / max(1.0, perim ** 2)
            vert = len(cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 0.015 * perim, True))
            if vert > 12 and circ < 0.75:
                continue
            if _nitidez_borde(peq, comp) < 0.35 or _frac_borde_nitido(peq, comp) < 0.6:
                continue
            nombre = "Banda" if (w > 0.6 * peq.shape[1] or h > 0.6 * peq.shape[0]) and rect > 0.8 else (
                "Rectángulo" if rect > 0.85 else ("Círculo" if abs(w - h) < 0.15 * max(w, h) and rect > 0.7 else "Forma"))
            conf = float(np.clip(solidez * (1 - sd / 5), 0, 1))
            full = cv2.resize(comp.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0
            res.append((full, conf, nombre, a))
    res.sort(key=lambda r: -r[3])
    return [(m, c, n) for m, c, n, _ in res[:max_capas]]


def _frac_borde_nitido(img: np.ndarray, comp: np.ndarray) -> float:
    """Fracción del contorno con un salto de color brusco (las formas gráficas tienen bordes
    duros; las zonas desenfocadas de una foto, no). Ignora el borde de la imagen."""
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
    gx = cv2.Sobel(lab, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lab, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt((gx ** 2 + gy ** 2).sum(-1)) / 4
    m = comp.astype(np.uint8)
    borde = (cv2.dilate(m, np.ones((3, 3), np.uint8)) - cv2.erode(m, np.ones((3, 3), np.uint8))) > 0
    borde[:2, :] = borde[-2:, :] = False
    borde[:, :2] = borde[:, -2:] = False
    if borde.sum() < 10:
        return 1.0
    # máximo local en una vecindad de 3 px (el salto puede caer justo al lado)
    mag_max = cv2.dilate(mag, np.ones((5, 5), np.uint8))
    return float((mag_max[borde] > 18).mean())


def _nitidez_borde(img: np.ndarray, comp: np.ndarray) -> float:
    """Proporción del salto de color que ocurre en 1-2 px en el borde (1 = borde duro)."""
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
    m = comp.astype(np.uint8)
    dentro = m & ~cv2.erode(m, np.ones((3, 3), np.uint8)).astype(bool)
    fuera1 = cv2.dilate(m, np.ones((5, 5), np.uint8)).astype(bool) & ~m.astype(bool)
    fuera2 = cv2.dilate(m, np.ones((13, 13), np.uint8)).astype(bool) & ~cv2.dilate(m, np.ones((9, 9), np.uint8)).astype(bool)
    if dentro.sum() < 5 or fuera1.sum() < 5 or fuera2.sum() < 5:
        return 0.0
    c_in = lab[comp].mean(0)
    salto_cerca = np.linalg.norm(lab[fuera1].mean(0) - c_in)
    salto_lejos = np.linalg.norm(lab[fuera2].mean(0) - c_in)
    del g
    return float(salto_cerca / max(salto_lejos, 1e-3)) if salto_lejos > 8 else 0.0


# ------------------------------------------------------------------ paleta

def paleta(img: np.ndarray, n: int = 8) -> list[str]:
    peq = cv2.resize(img, (128, int(128 * img.shape[0] / img.shape[1]) or 1), interpolation=cv2.INTER_AREA)
    datos = cv2.cvtColor(peq, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    cv2.setRNGSeed(2)
    _, et, centros = cv2.kmeans(datos, n, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    cuentas = np.bincount(et.ravel(), minlength=n)
    orden = np.argsort(-cuentas)
    rgb = cv2.cvtColor(centros[orden].reshape(1, -1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB)[0]
    return [tx._hex(c) for c in rgb]


# ------------------------------------------------------------------ comparación

def componer(capas_rgba: list[tuple[np.ndarray, int, int]], tam: tuple[int, int]) -> np.ndarray:
    H, W = tam
    out = np.zeros((H, W, 3), np.float32)
    for rgba, x, y in capas_rgba:
        h, w = rgba.shape[:2]
        x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
        if x1 <= x0 or y1 <= y0:
            continue
        r = rgba[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
        a = r[..., 3:4] / 255
        out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - a) + r[..., :3] * a
    return out.clip(0, 255).round().astype(np.uint8)


def comparar(a: np.ndarray, b: np.ndarray) -> dict:
    from skimage.metrics import structural_similarity

    mse = float(((a.astype(np.float32) - b.astype(np.float32)) ** 2).mean())
    psnr = 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)
    ga, gb = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY), cv2.cvtColor(b, cv2.COLOR_RGB2GRAY)
    ssim = float(structural_similarity(ga, gb, data_range=255))
    dif = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(-1)
    return {"psnr": round(psnr, 2), "ssim": round(ssim, 4), "pixeles_distintos": round(float((dif > 40).mean()), 4)}


# ------------------------------------------------------------------ proceso principal

def descomponer(img: np.ndarray, almacen: Almacen, progreso: Progreso | None = None, opciones: dict | None = None) -> Resultado:
    opciones = opciones or {}
    t0 = time.time()
    avisos: list[str] = []
    segment.AVISOS.clear()
    inpaint.AVISOS.clear()
    H, W = img.shape[:2]
    diag = math.hypot(W, H)

    def prog(p: float, msg: str):
        log.info("[%3d%%] %s", int(p * 100), msg)
        if progreso:
            progreso(p, msg)

    tiempos = {}

    # 1. textos -----------------------------------------------------------
    prog(0.03, "Buscando textos…")
    t = time.time()
    estilos: list[tx.EstiloTexto] = []
    try:
        estilos = tx.analizar_textos(img, lambda m: prog(0.08, m))
    except Exception:
        log.exception("Fallo en el OCR")
        avisos.append("No se pudieron analizar los textos; puedes añadirlos a mano.")
    textos_ok, textos_img = [], []
    mascara_texto = np.zeros((H, W), bool)
    for e in estilos:
        alto = e.caja_tinta["h"]
        if (alto < 0.02 * diag and e.fidelidad < 0.6) or (alto < 0.035 * diag and e.fidelidad < 0.45):
            continue  # texto pequeño dudoso (rótulos, logotipos de la foto): se deja en el fondo
        mascara_texto |= e.mascara
        if e.fidelidad >= 0.5:
            textos_ok.append(e)
        else:
            textos_img.append(e)
    tiempos["textos"] = round(time.time() - t, 2)

    # 2. imagen sin textos --------------------------------------------------
    prog(0.25, "Borrando los textos del fondo…")
    t = time.time()
    limpia = inpaint.rellenar(img, mascara_texto, dilatar=2) if mascara_texto.any() else img.copy()
    tiempos["relleno_textos"] = round(time.time() - t, 2)

    # 3. sujetos ------------------------------------------------------------
    prog(0.4, "Detectando personas y objetos…")
    t = time.time()
    sujetos = []  # (alfa, confianza, nombre, rol)
    try:
        sujetos = _sujetos(limpia, mascara_texto, prog)
    except segment.ModeloNoDisponible as e:
        avisos.append(str(e))
    except Exception:
        log.exception("Fallo en la segmentación")
        avisos.append("La segmentación automática falló: puedes recortar sujetos con clics o pincel.")
    tiempos["sujetos"] = round(time.time() - t, 2)

    # 4. gráficos -----------------------------------------------------------
    prog(0.7, "Buscando elementos gráficos…")
    t = time.time()
    ocupado = mascara_texto.copy()
    for a, *_ in sujetos:
        ocupado |= a > 0.05
    graficos = []
    try:
        graficos = detectar_graficos(limpia, ocupado)
    except Exception:
        log.exception("Fallo detectando gráficos")
    tiempos["graficos"] = round(time.time() - t, 2)

    # 5. fondo --------------------------------------------------------------
    prog(0.78, "Reconstruyendo el fondo…")
    t = time.time()
    hueco = np.zeros((H, W), bool)
    for a, *_ in sujetos:
        hueco |= a > 0.03
    for m, *_ in graficos:
        hueco |= m
    k = max(3, int(diag * 0.004))
    hueco = cv2.dilate(hueco.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))) > 0
    fondo = inpaint.rellenar(limpia, hueco) if hueco.any() else limpia
    tiempos["relleno_fondo"] = round(time.time() - t, 2)

    # 6. capas --------------------------------------------------------------
    prog(0.92, "Creando las capas…")
    capas = []
    compuestas = []
    frac_rec = float((hueco | mascara_texto).mean())
    c_fondo = capa_imagen("Fondo reconstruido", "fondo", almacen.guardar(fondo), 0, 0, W, H)
    c_fondo["confidence"] = round(1 - 0.6 * frac_rec, 3)
    capas.append(c_fondo)
    compuestas.append((np.dstack([fondo, np.full((H, W), 255, np.uint8)]), 0, 0))

    for m, conf, nombre in graficos:
        alfa = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7)
        r = segment.rgba_recortado(limpia, np.maximum(alfa, m.astype(np.float32)) * (alfa > 0.02))
        if r is None:
            continue
        rgba, (x, y) = r
        c = capa_imagen(nombre, "grafico", almacen.guardar(rgba), x, y, rgba.shape[1], rgba.shape[0])
        c["confidence"] = round(conf, 3)
        capas.append(c)
        compuestas.append((rgba, x, y))

    for alfa, conf, nombre, rol in sujetos:
        r = segment.rgba_recortado(limpia, alfa)
        if r is None:
            continue
        rgba, (x, y) = r
        c = capa_imagen(nombre, rol, almacen.guardar(rgba), x, y, rgba.shape[1], rgba.shape[0])
        c["confidence"] = round(conf, 3)
        capas.append(c)
        compuestas.append((rgba, x, y))

    for e in textos_img:
        # no se pudo reproducir con fidelidad: capa de imagen recortada + texto oculto para recrearlo
        alfa = cv2.GaussianBlur(e.mascara.astype(np.float32), (0, 0), 0.8)
        r = segment.rgba_recortado(img, alfa)
        if r is None:
            continue
        rgba, (x, y) = r
        ci = capa_imagen(f"Texto (imagen): {e.texto[:20]}", "texto-imagen", almacen.guardar(rgba), x, y, rgba.shape[1], rgba.shape[0])
        ci["confidence"] = round(0.5 * e.puntuacion_ocr + 0.5 * e.fidelidad, 3)
        ci["warnings"].append("Este texto no se pudo reconstruir fielmente y se ha dejado como imagen. "
                              "Puedes recrearlo como texto editable desde el panel de propiedades.")
        ct = capa_texto(e, H)
        ct["visible"] = False
        ct["warnings"].append("Versión editable aproximada (oculta). Actívala con «Recrear como texto».")
        ci["linkedTextId"] = ct["id"]
        capas.append(ci)
        capas.append(ct)
        compuestas.append((rgba, x, y))

    for e in textos_ok:
        capas.append(capa_texto(e, H))
        rgba_t, _ = tx.renderizar_estilo(e, (H, W))
        compuestas.append((rgba_t, 0, 0))

    c_orig = capa_imagen("Original (referencia)", "original", almacen.guardar(img, formato="png"), 0, 0, W, H)
    c_orig["locked"] = True
    c_orig["visible"] = False
    c_orig["confidence"] = 1.0
    capas.append(c_orig)

    recon = componer(compuestas, (H, W))
    metricas = comparar(img, recon)
    metricas["tiempos_s"] = tiempos
    metricas["total_s"] = round(time.time() - t0, 2)
    metricas["capas"] = {r: sum(1 for c in capas if c["role"] == r) for r in {c["role"] for c in capas}}
    url_recon = almacen.guardar(recon, "reconstruccion.png")
    avisos.extend(segment.AVISOS)
    avisos.extend(inpaint.AVISOS)
    if metricas["ssim"] < 0.75:
        avisos.append("La reconstrucción difiere bastante del original: revisa las capas marcadas con baja confianza.")
    proyecto = {
        "version": 1,
        "width": W,
        "height": H,
        "background": "#000000",
        "layers": capas,
        "palette": paleta(img),
        "decomposition": {"metrics": metricas, "reconstructionSrc": url_recon, "warnings": avisos},
    }
    prog(1.0, "Listo")
    return Resultado(proyecto, metricas, avisos)


def _sujetos(img: np.ndarray, mascara_texto: np.ndarray, prog: Progreso):  # noqa: ARG001
    H, W = img.shape[:2]
    area = H * W
    dets = segment.detectar(img, 0.45)
    personas = [d for d in dets if d.etiqueta == "person"]
    objetos = [d for d in dets if d.etiqueta != "person" and d.etiqueta.replace(" ", "") not in CLASES_FONDO]

    def area_caja(d):
        x0, y0, x1, y1 = d.caja
        return max(0, x1 - x0) * max(0, y1 - y0)

    personas = [d for d in personas if area_caja(d) > 0.012 * area and d.puntuacion >= 0.5]
    if personas:  # las personas mucho más pequeñas que la principal son parte del fondo
        mayor = max(area_caja(d) for d in personas)
        personas = [d for d in personas if area_caja(d) >= 0.2 * mayor or area_caja(d) > 0.08 * area]
    objetos = [d for d in objetos if area_caja(d) > 0.012 * area and d.puntuacion >= 0.55]
    personas = sorted(personas, key=area_caja, reverse=True)[:6]
    objetos = sorted(objetos, key=area_caja, reverse=True)[:4]
    elegidas = personas + objetos
    resultado = []
    union = np.zeros((H, W), bool)
    if elegidas:
        prog(0.5, f"Recortando {len(elegidas)} sujeto(s)…")
        mascaras = segment.sam_mascaras(img, cajas=[d.caja for d in elegidas])
        for d, (m, iou) in zip(elegidas, mascaras):
            m = segment.limpiar_mascara(m, area_min=int(area * 0.0005))
            m = _rellenar_huecos(m)
            if m.sum() < 0.2 * area_caja(d):
                continue
            # no se queda con píxeles de los textos (se rellenaron antes)
            alfa = segment.afinar_alfa(img, m)
            conf = float(np.clip(iou * (0.5 + 0.5 * d.puntuacion), 0, 1))
            nombre = segment.ETIQUETAS_ES.get(d.etiqueta, d.etiqueta.capitalize())
            rol = "sujeto" if d.etiqueta == "person" else "objeto"
            if rol == "objeto" and _es_plano(img, m):
                rol, nombre = "grafico", "Forma"
            resultado.append([alfa, conf, nombre, rol, d.caja[3]])
            union |= alfa > 0.5
    # lo que el detector no conoce: primer plano saliente (BiRefNet)
    prog(0.6, "Buscando otros elementos destacados…")
    try:
        sal = segment.saliencia(img)
    except segment.MemoriaInsuficiente as e:
        segment.AVISOS.append(str(e))
        sal = np.zeros((H, W), np.float32)
    resto = (sal > 0.5) & ~union  # los textos ya se borraron de la imagen
    n, lab, st, _ = cv2.connectedComponentsWithStats(resto.astype(np.uint8), 8)
    for i in range(1, n):
        comp_i = lab == i
        if st[i, cv2.CC_STAT_AREA] < 0.004 * area:
            continue
        comp = cv2.dilate(comp_i.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        alfa = np.where(comp, sal, 0).astype(np.float32)
        # pegado a un objeto (no persona) ya recortado → forma parte de él (platillo, cuchara…)
        vecino = None
        for r in resultado:
            if r[3] != "sujeto" and ((r[0] > 0.5) & cv2.dilate(comp_i.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)).any():
                vecino = r
                break
        if vecino is not None:
            vecino[0] = np.maximum(vecino[0], alfa)
            continue
        if st[i, cv2.CC_STAT_AREA] < 0.02 * area:
            continue
        conf = float(sal[comp_i].mean()) * 0.8
        rol, nombre = ("grafico", "Forma") if _es_plano(img, comp_i) else ("objeto", "Elemento")
        resultado.append([alfa, conf, nombre, rol, st[i, cv2.CC_STAT_TOP] + st[i, cv2.CC_STAT_HEIGHT]])
    # si no hay detecciones pero la saliencia es fuerte y grande, es el sujeto principal
    if not resultado and (sal > 0.5).mean() > 0.03:
        resultado.append([sal.astype(np.float32), float(sal[sal > 0.5].mean()) * 0.8, "Sujeto", "sujeto", H])
    # une piezas del mismo objeto (misma clase) que se tocan, p. ej. un objeto tapado en medio
    k15 = np.ones((15, 15), np.uint8)
    i = 0
    while i < len(resultado):
        j = i + 1
        while j < len(resultado):
            a, b = resultado[i], resultado[j]
            if a[3] == b[3] == "objeto" and a[2] == b[2] and (cv2.dilate((a[0] > 0.5).astype(np.uint8), k15).astype(bool) & (b[0] > 0.5)).any():
                a[0] = np.maximum(a[0], b[0])
                a[1] = max(a[1], b[1])
                a[4] = max(a[4], b[4])
                resultado.pop(j)
            else:
                j += 1
        i += 1
    # orden de atrás a delante (más abajo = más cerca) y oclusiones
    resultado.sort(key=lambda r: r[4])
    for i in range(len(resultado)):
        for j in range(i + 1, len(resultado)):
            delante = resultado[j][0]
            resultado[i][0] = resultado[i][0] * (1 - np.clip(delante * 1.2, 0, 1))
    # nombres únicos
    vistos: dict[str, int] = {}
    for r in resultado:
        vistos[r[2]] = vistos.get(r[2], 0) + 1
        if vistos[r[2]] > 1 or sum(1 for x in resultado if x[2] == r[2]) > 1:
            r[2] = f"{r[2]} {vistos[r[2]]}"
    return [(a, c, nm, rol) for a, c, nm, rol, _ in resultado if (a > 0.5).sum() > 0.003 * area]


CLASES_FONDO = {"diningtable", "bed", "couch", "sofa", "bench", "toilet", "sink", "refrigerator", "oven", "tv", "tvmonitor", "chair", "pottedplant"}


def _rellenar_huecos(m: np.ndarray) -> np.ndarray:
    inv = (~m).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 4)
    out = m.copy()
    H, W = m.shape
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if x > 0 and y > 0 and x + w < W and y + h < H and a < 0.5 * m.sum():
            out[lab == i] = True
    return out


def _es_plano(img: np.ndarray, m: np.ndarray) -> bool:
    """¿La región es de color casi uniforme (un elemento gráfico y no un objeto fotografiado)?"""
    nucleo = cv2.erode(m.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    if nucleo.sum() < 50:
        return False
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)[nucleo]
    centro = np.median(lab, 0)
    return float((np.linalg.norm(lab - centro, axis=1) < 10).mean()) > 0.75


def guardar_json(ruta: Path, datos: dict) -> None:
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(ruta)
