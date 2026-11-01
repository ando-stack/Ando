"""Relleno inteligente (inpainting) con Big-LaMa. Si el modelo no está o falla, se usa
el relleno clásico de OpenCV (Telea) como último recurso, avisando."""
from __future__ import annotations

import logging
import threading

import cv2
import numpy as np

from .device import dispositivo, es_falta_de_memoria, liberar_memoria
from .models import registry as reg

log = logging.getLogger("estudio")
_cerrojo = threading.RLock()
_modelo = {"lama": None, "dispositivo": None}
AVISOS: list[str] = []


def _lama():
    with _cerrojo:
        if _modelo["lama"] is None:
            import torch

            if not reg.disponible("lama"):
                return None
            ruta = reg.ruta_local(reg.MODELOS["lama"])
            disp = dispositivo()
            # TorchScript de IOPaint; en MPS algunas operaciones FFT no están soportadas → CPU
            if disp == "mps":
                disp = "cpu"
            import warnings

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                _modelo["lama"] = torch.jit.load(str(ruta), map_location=disp).eval()
            _modelo["dispositivo"] = disp
        return _modelo["lama"]


def _pad(x: np.ndarray, mod: int = 8) -> np.ndarray:
    h, w = x.shape[:2]
    pads = ((0, (mod - h % mod) % mod), (0, (mod - w % mod) % mod)) + ((0, 0),) * (x.ndim - 2)
    return np.pad(x, pads, mode="symmetric")


def _lama_crop(m, img: np.ndarray, mask: np.ndarray, disp: str) -> np.ndarray:
    import torch

    h, w = img.shape[:2]
    a = torch.from_numpy(_pad(img)).permute(2, 0, 1)[None].float().div(255).to(disp)
    b = torch.from_numpy(_pad(mask.astype(np.uint8) * 255))[None, None].float().div(255).to(disp)
    b = (b > 0).float()
    with torch.inference_mode():
        o = m(a, b)
    return (o[0].permute(1, 2, 0).float().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)[:h, :w]


def _cajas(mask: np.ndarray, margen_rel: float = 0.6, margen_min: int = 48) -> list[tuple[int, int, int, int]]:
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    H, W = mask.shape
    cajas = []
    for i in range(1, n):
        x, y, w, h, _ = stats[i]
        mg = max(margen_min, int(max(w, h) * margen_rel))
        cajas.append([max(0, x - mg), max(0, y - mg), min(W, x + w + mg), min(H, y + h + mg)])
    # fusiona cajas solapadas
    cambiado = True
    while cambiado:
        cambiado = False
        for i in range(len(cajas)):
            for j in range(i + 1, len(cajas)):
                a, b = cajas[i], cajas[j]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    cajas[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    cajas.pop(j)
                    cambiado = True
                    break
            if cambiado:
                break
    return [tuple(c) for c in cajas]


def rellenar(img: np.ndarray, mascara: np.ndarray, max_lado: int = 1024, dilatar: int = 0) -> np.ndarray:
    """Devuelve una copia de `img` (RGB uint8) con la zona `mascara` reconstruida."""
    mask = mascara.astype(bool)
    if dilatar > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilatar + 1, 2 * dilatar + 1))
        mask = cv2.dilate(mask.astype(np.uint8), k) > 0
    if not mask.any():
        return img.copy()
    out = img.copy()
    m = _lama()
    if m is None:
        AVISOS.append("LaMa no está instalado: se usa un relleno básico de OpenCV.")
        return cv2.inpaint(img, mask.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
    disp = _modelo["dispositivo"]
    for x0, y0, x1, y1 in _cajas(mask):
        crop, mc = img[y0:y1, x0:x1], mask[y0:y1, x0:x1]
        lado = max_lado
        while True:
            esc = min(1.0, lado / max(crop.shape[:2]))
            if esc < 1:
                tam = (max(8, int(crop.shape[1] * esc)), max(8, int(crop.shape[0] * esc)))
                c_r = cv2.resize(crop, tam, interpolation=cv2.INTER_AREA)
                m_r = cv2.resize(mc.astype(np.uint8), tam, interpolation=cv2.INTER_NEAREST) > 0
                m_r = cv2.dilate(m_r.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
            else:
                c_r, m_r = crop, mc
            try:
                res = _lama_crop(m, c_r, m_r, disp)
                break
            except Exception as e:
                if not es_falta_de_memoria(e):
                    log.exception("LaMa falló; se usa OpenCV")
                    AVISOS.append("El relleno inteligente falló en una zona: se usó un relleno básico.")
                    res = cv2.inpaint(c_r, m_r.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
                    break
                liberar_memoria()
                if lado > 512:
                    lado //= 2
                    AVISOS.append(f"Memoria insuficiente: el relleno se procesa a {lado}px.")
                    continue
                if disp != "cpu":
                    disp = "cpu"
                    m = m.to("cpu")
                    _modelo["dispositivo"] = "cpu"
                    AVISOS.append("Memoria de GPU insuficiente: el relleno se hace en la CPU.")
                    continue
                raise
        if esc < 1:
            res = cv2.resize(res, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_CUBIC)
        # mezcla suave en el borde de la máscara para no dejar costuras
        suave = cv2.GaussianBlur(mc.astype(np.float32), (0, 0), 1.5)
        suave = np.maximum(suave, mc.astype(np.float32))[..., None]
        out[y0:y1, x0:x1] = (res * suave + out[y0:y1, x0:x1] * (1 - suave)).round().astype(np.uint8)
    return out


def descargar_memoria() -> None:
    with _cerrojo:
        _modelo["lama"] = None
    liberar_memoria()
