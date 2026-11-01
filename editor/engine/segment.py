"""Segmentación y recorte: detección (RT-DETRv2), máscaras por caja/clic (SAM 2.1),
recorte de fondo de alta calidad (BiRefNet ONNX) y afinado de bordes (ViTMatte)."""
from __future__ import annotations

import hashlib
import logging
import os
import threading
from dataclasses import dataclass

import cv2
import numpy as np

from .device import dispositivo, es_falta_de_memoria, liberar_memoria, proveedores_onnx
from .models import registry as reg

log = logging.getLogger("estudio")
os.environ.setdefault("HF_HOME", str(reg.HF_HOME))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

_cerrojo = threading.RLock()
_cache: dict[str, object] = {}
AVISOS: list[str] = []  # avisos de la última operación (p. ej. paso a CPU por falta de memoria)


def _aviso(txt: str) -> None:
    log.warning(txt)
    AVISOS.append(txt)


class ModeloNoDisponible(RuntimeError):
    pass


def _requiere(clave: str) -> reg.Modelo:
    if not reg.disponible(clave):
        raise ModeloNoDisponible(
            f"Falta el modelo «{clave}». Ejecuta: python scripts/instalar.py --modelos"
        )
    return reg.MODELOS[clave]


# ---------------------------------------------------------------- BiRefNet (ONNX)

def _sesion_birefnet():
    with _cerrojo:
        if "birefnet" not in _cache:
            import onnxruntime as ort

            clave = "birefnet" if reg.disponible("birefnet") else "birefnet_lite"
            m = _requiere(clave)
            opciones = ort.SessionOptions()
            opciones.log_severity_level = 3
            # sin «arena»: la memoria de activaciones (~6-7 GB a 1024 px) se devuelve al terminar
            opciones.enable_cpu_mem_arena = False
            opciones.enable_mem_pattern = False
            ruta = str(reg.ruta_local(m, "onnx/model.onnx"))
            _cache["birefnet_ruta"] = ruta
            _cache["birefnet"] = ort.InferenceSession(ruta, opciones, providers=proveedores_onnx())
        return _cache["birefnet"]


RAM_BIREFNET_GB = float(os.environ.get("ESTUDIO_RAM_BIREFNET_GB", "7.5"))


class MemoriaInsuficiente(RuntimeError):
    pass


def ram_disponible_gb() -> float:
    try:
        import psutil

        return psutil.virtual_memory().available / 1e9
    except Exception:  # pragma: no cover
        return 99.0


def saliencia(img: np.ndarray) -> np.ndarray:
    """Alfa (0..1, float32, HxW) del primer plano principal de una imagen RGB uint8.
    Lanza MemoriaInsuficiente si el equipo no tiene RAM libre suficiente para BiRefNet."""
    if dispositivo() == "cpu" and ram_disponible_gb() < RAM_BIREFNET_GB:
        raise MemoriaInsuficiente(
            f"Hay menos de {RAM_BIREFNET_GB:.1f} GB de RAM libre: se usa el recorte con SAM en lugar de BiRefNet."
        )
    s = _sesion_birefnet()
    h, w = img.shape[:2]
    x = cv2.resize(img, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    try:
        y = s.run(None, {s.get_inputs()[0].name: x})[0][0, 0]
    except Exception as e:  # falta de memoria en GPU → CPU
        if not es_falta_de_memoria(e):
            raise
        _aviso("Memoria de GPU insuficiente para BiRefNet: se usa la CPU (más lento).")
        import onnxruntime as ort

        cpu = ort.InferenceSession(str(_cache["birefnet_ruta"]), providers=["CPUExecutionProvider"])
        y = cpu.run(None, {cpu.get_inputs()[0].name: x})[0][0, 0]
    y = 1.0 / (1.0 + np.exp(-y.astype(np.float32)))
    return cv2.resize(y, (w, h), interpolation=cv2.INTER_LINEAR).clip(0, 1)


# ---------------------------------------------------------------- RT-DETRv2

def _detector():
    with _cerrojo:
        if "rtdetr" not in _cache:
            import torch  # noqa: F401
            from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

            m = _requiere("rtdetr")
            proc = RTDetrImageProcessor.from_pretrained(m.repo, revision=m.revision)
            mod = RTDetrV2ForObjectDetection.from_pretrained(m.repo, revision=m.revision).eval().to(dispositivo())
            _cache["rtdetr"] = (proc, mod)
        return _cache["rtdetr"]


@dataclass
class Deteccion:
    etiqueta: str
    puntuacion: float
    caja: tuple[int, int, int, int]  # x0, y0, x1, y1


ETIQUETAS_ES = {
    "person": "Persona", "sports ball": "Balón", "car": "Coche", "motorcycle": "Moto", "bicycle": "Bicicleta",
    "dog": "Perro", "cat": "Gato", "cup": "Taza", "bottle": "Botella", "tennis racket": "Raqueta",
    "baseball bat": "Bate", "baseball glove": "Guante", "skateboard": "Monopatín", "surfboard": "Tabla de surf",
    "skis": "Esquís", "frisbee": "Disco", "chair": "Silla", "laptop": "Portátil", "cell phone": "Móvil",
    "tv": "Pantalla", "book": "Libro", "clock": "Reloj", "horse": "Caballo", "bird": "Pájaro",
    "airplane": "Avión", "truck": "Camión", "bus": "Autobús", "boat": "Barco", "backpack": "Mochila",
    "handbag": "Bolso", "spoon": "Cuchara", "fork": "Tenedor", "knife": "Cuchillo", "diningtable": "Mesa",
    "sportsball": "Balón", "tennisracket": "Raqueta", "baseballbat": "Bate", "baseballglove": "Guante",
    "cellphone": "Móvil", "teddybear": "Peluche", "wineglass": "Copa", "motorbike": "Moto", "aeroplane": "Avión", "tie": "Corbata", "umbrella": "Paraguas", "teddy bear": "Peluche", "bowl": "Cuenco",
    "banana": "Plátano", "apple": "Manzana", "pizza": "Pizza", "cake": "Tarta", "wine glass": "Copa",
}


def detectar(img: np.ndarray, umbral: float = 0.5) -> list[Deteccion]:
    import torch
    from PIL import Image

    proc, mod = _detector()
    pil = Image.fromarray(img)
    with torch.inference_mode():
        entrada = {k: v.to(dispositivo()) for k, v in proc(pil, return_tensors="pt").items()}
        try:
            out = mod(**entrada)
        except Exception as e:
            if not es_falta_de_memoria(e):
                raise
            liberar_memoria()
            _aviso("Memoria de GPU insuficiente para el detector: se usa la CPU.")
            mod.to("cpu")
            out = mod(**{k: v.to("cpu") for k, v in entrada.items()})
        r = proc.post_process_object_detection(out, target_sizes=[img.shape[:2]], threshold=umbral)[0]
    dets = []
    for s, l, b in zip(r["scores"], r["labels"], r["boxes"]):
        x0, y0, x1, y1 = [int(round(float(v))) for v in b]
        dets.append(Deteccion(mod.config.id2label[int(l)], float(s), (max(0, x0), max(0, y0), x1, y1)))
    return dets


# ---------------------------------------------------------------- SAM 2.1

def _sam():
    with _cerrojo:
        if "sam" not in _cache:
            from transformers import Sam2Model, Sam2Processor

            m = _requiere("sam2")
            proc = Sam2Processor.from_pretrained(m.repo, revision=m.revision)
            mod = Sam2Model.from_pretrained(m.repo, revision=m.revision).eval().to(dispositivo())
            _cache["sam"] = (proc, mod)
            _cache["sam_emb"] = {}
        return _cache["sam"]


def _embeddings(img: np.ndarray):
    """Embeddings de SAM con caché por imagen (el clic interactivo reutiliza el cálculo)."""
    import torch
    from PIL import Image

    proc, mod = _sam()
    clave = hashlib.sha1(img.tobytes()[:: max(1, img.size // 200_000)] + bytes(str(img.shape), "ascii")).hexdigest()
    cache: dict = _cache["sam_emb"]  # type: ignore[assignment]
    if clave in cache:
        return cache[clave]
    entrada = proc(images=Image.fromarray(img), return_tensors="pt")
    with torch.inference_mode():
        try:
            emb = mod.get_image_embeddings(entrada["pixel_values"].to(dispositivo()))
        except Exception as e:
            if not es_falta_de_memoria(e):
                raise
            liberar_memoria()
            _aviso("Memoria de GPU insuficiente para SAM: se usa la CPU.")
            mod.to("cpu")
            emb = mod.get_image_embeddings(entrada["pixel_values"])
    if len(cache) > 4:
        cache.pop(next(iter(cache)))
    cache[clave] = (emb, entrada["original_sizes"])
    return cache[clave]


def sam_mascaras(
    img: np.ndarray,
    cajas: list[tuple[int, int, int, int]] | None = None,
    puntos: list[tuple[float, float]] | None = None,
    etiquetas: list[int] | None = None,
) -> list[tuple[np.ndarray, float]]:
    """Máscaras booleanas (HxW) y su puntuación. Con `cajas`: una máscara por caja.
    Con `puntos`: una sola máscara (clics positivos=1 / negativos=0), opcionalmente con 1 caja."""
    import torch
    from PIL import Image

    proc, mod = _sam()
    emb, tam = _embeddings(img)
    pil = Image.fromarray(img)
    kwargs = {}
    if puntos:
        kwargs["input_points"] = [[[list(map(float, p)) for p in puntos]]]
        kwargs["input_labels"] = [[[int(v) for v in (etiquetas or [1] * len(puntos))]]]
        if cajas:
            kwargs["input_boxes"] = [[list(map(float, cajas[0]))]]
    elif cajas:
        kwargs["input_boxes"] = [[list(map(float, c)) for c in cajas]]
    else:
        return []
    entrada = proc(images=pil, return_tensors="pt", **kwargs)
    disp = emb[0].device if isinstance(emb, (list, tuple)) else next(mod.parameters()).device
    args = {k: entrada[k].to(disp) for k in ("input_points", "input_labels", "input_boxes") if k in entrada}
    with torch.inference_mode():
        out = mod(image_embeddings=emb, multimask_output=bool(puntos) and not cajas, **args)
    masks = proc.post_process_masks(out.pred_masks.cpu(), tam)[0]  # (n, k, H, W)
    iou = out.iou_scores.cpu()[0]  # (n, k)
    res = []
    for i in range(masks.shape[0]):
        k = int(torch.argmax(iou[i])) if masks.shape[1] > 1 else 0
        res.append((masks[i, k].numpy().astype(bool), float(iou[i, k])))
    return res


# ---------------------------------------------------------------- ViTMatte

def _vitmatte():
    with _cerrojo:
        if "vitmatte" not in _cache:
            from transformers import VitMatteForImageMatting, VitMatteImageProcessor

            m = _requiere("vitmatte")
            proc = VitMatteImageProcessor.from_pretrained(m.repo, revision=m.revision)
            mod = VitMatteForImageMatting.from_pretrained(m.repo, revision=m.revision).eval().to(dispositivo())
            _cache["vitmatte"] = (proc, mod)
        return _cache["vitmatte"]


def afinar_alfa(img: np.ndarray, mascara: np.ndarray, banda: int | None = None, max_lado: int = 1024) -> np.ndarray:
    """Convierte una máscara binaria en un alfa suave (pelo, bordes) con ViTMatte.
    Si ViTMatte no está disponible devuelve un alfa con suavizado guiado sencillo."""
    import torch
    from PIL import Image

    m8 = mascara.astype(np.uint8) * 255
    ys, xs = np.nonzero(m8)
    if len(xs) == 0:
        return np.zeros(mascara.shape, np.float32)
    h, w = mascara.shape
    lado = max(xs.max() - xs.min(), ys.max() - ys.min())
    banda = banda or int(np.clip(lado * 0.02, 4, 25))
    pad = banda * 3
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(w, xs.max() + pad + 1), min(h, ys.max() + pad + 1)
    crop, mc = img[y0:y1, x0:x1], m8[y0:y1, x0:x1]
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (banda * 2 + 1, banda * 2 + 1))
    tri = np.full(mc.shape, 128, np.uint8)
    tri[cv2.erode(mc, k) > 0] = 255
    tri[cv2.dilate(mc, k) == 0] = 0
    esc = min(1.0, max_lado / max(crop.shape[:2]))
    if esc < 1:
        tam = (int(crop.shape[1] * esc), int(crop.shape[0] * esc))
        crop_r = cv2.resize(crop, tam, interpolation=cv2.INTER_AREA)
        tri_r = cv2.resize(tri, tam, interpolation=cv2.INTER_NEAREST)
    else:
        crop_r, tri_r = crop, tri
    try:
        proc, mod = _vitmatte()
        with torch.inference_mode():
            entrada = proc(images=Image.fromarray(crop_r), trimaps=Image.fromarray(tri_r), return_tensors="pt")
            entrada = {k: v.to(next(mod.parameters()).device) for k, v in entrada.items()}
            a = mod(**entrada).alphas[0, 0].float().cpu().numpy()[: crop_r.shape[0], : crop_r.shape[1]]
    except ModeloNoDisponible:
        a = cv2.GaussianBlur(mc.astype(np.float32) / 255, (0, 0), 1.2)
        a = cv2.resize(a, (crop_r.shape[1], crop_r.shape[0]))
    except Exception as e:
        if not es_falta_de_memoria(e):
            raise
        liberar_memoria()
        _aviso("Memoria insuficiente para afinar bordes: se usa un suavizado simple.")
        a = cv2.GaussianBlur(mc.astype(np.float32) / 255, (0, 0), 1.2)
        a = cv2.resize(a, (crop_r.shape[1], crop_r.shape[0]))
    if esc < 1:
        a = cv2.resize(a, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LINEAR)
    a = np.where(tri == 255, 1.0, np.where(tri == 0, 0.0, a)).astype(np.float32)
    out = np.zeros(mascara.shape, np.float32)
    out[y0:y1, x0:x1] = a.clip(0, 1)
    return out


# ---------------------------------------------------------------- utilidades de recorte

def estimar_primer_plano(img: np.ndarray, alfa: np.ndarray) -> np.ndarray:
    """Reduce el halo del fondo en los bordes semitransparentes: en la zona de borde
    sustituye el color por el del interior más cercano (aproximación rápida)."""
    borde = (alfa > 0.02) & (alfa < 0.98)
    if not borde.any():
        return img
    interior = (alfa >= 0.98).astype(np.uint8)
    if interior.sum() < 10:
        return img
    _, idx = cv2.distanceTransformWithLabels(1 - interior, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(interior)
    tabla = np.zeros((idx.max() + 1, 3), np.float32)
    tabla[idx[ys, xs]] = img[ys, xs]
    cercano = tabla[idx]
    out = img.astype(np.float32).copy()
    a = alfa[..., None]
    mezcla = np.where(borde[..., None], cercano * (1 - a) * 0.6 + out * (1 - (1 - a) * 0.6), out)
    return mezcla.clip(0, 255).astype(np.uint8)


def rgba_recortado(img: np.ndarray, alfa: np.ndarray, margen: int = 2):
    """Devuelve (rgba recortado a su caja, (x, y)) o None si está vacío."""
    ys, xs = np.nonzero(alfa > 0.01)
    if len(xs) == 0:
        return None
    x0, y0 = max(0, xs.min() - margen), max(0, ys.min() - margen)
    x1, y1 = min(img.shape[1], xs.max() + margen + 1), min(img.shape[0], ys.max() + margen + 1)
    rgb = estimar_primer_plano(img[y0:y1, x0:x1], alfa[y0:y1, x0:x1])
    a = (alfa[y0:y1, x0:x1] * 255).round().astype(np.uint8)
    return np.dstack([rgb, a]), (int(x0), int(y0))


def quitar_fondo(img: np.ndarray, afinar: bool = True) -> np.ndarray:
    """RGBA del sujeto principal (para importar fotos propias)."""
    try:
        a = saliencia(img)
    except MemoriaInsuficiente as e:
        _aviso(str(e))
        return _quitar_fondo_sam(img)
    if afinar:
        try:
            a2 = afinar_alfa(img, a > 0.5)
            # combina: BiRefNet ya es muy bueno; ViTMatte solo en la banda dudosa
            dudosa = (a > 0.05) & (a < 0.95)
            a = np.where(dudosa, np.maximum(a, a2) * 0.5 + np.minimum(a, a2) * 0.5, a)
        except ModeloNoDisponible:
            pass
    return np.dstack([estimar_primer_plano(img, a), (a * 255).round().astype(np.uint8)])


def _quitar_fondo_sam(img: np.ndarray) -> np.ndarray:
    """Alternativa ligera: persona/objeto más grande detectado (o el centro) con SAM + ViTMatte."""
    H, W = img.shape[:2]
    try:
        dets = detectar(img, 0.4)
    except ModeloNoDisponible:
        dets = []
    if dets:
        d = max(dets, key=lambda d: (d.caja[2] - d.caja[0]) * (d.caja[3] - d.caja[1]) * (2 if d.etiqueta == "person" else 1))
        m, _ = sam_mascaras(img, cajas=[d.caja])[0]
    else:
        m, _ = sam_mascaras(img, puntos=[(W / 2, H / 2)], etiquetas=[1])[0]
    a = afinar_alfa(img, limpiar_mascara(m))
    return np.dstack([estimar_primer_plano(img, a), (a * 255).round().astype(np.uint8)])


def limpiar_mascara(m: np.ndarray, area_min: int = 64) -> np.ndarray:
    """Quita islas pequeñas y rellena agujeros pequeños."""
    m8 = m.astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m8, 8)
    out = np.zeros_like(m8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= area_min:
            out[lab == i] = 1
    inv = 1 - out
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        toca_borde = x == 0 or y == 0 or x + w >= m.shape[1] or y + h >= m.shape[0]
        if not toca_borde and a < area_min:
            out[lab == i] = 1
    return out.astype(bool)


def descargar_modelos_memoria() -> None:
    with _cerrojo:
        _cache.clear()
    liberar_memoria()
