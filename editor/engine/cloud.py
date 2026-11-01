"""Adaptador OPCIONAL de relleno generativo en la nube (API oficial de imágenes de OpenAI).

Desactivado por defecto. Para usarlo hay que poner NUBE_ACTIVADA=true y OPENAI_API_KEY en
.env, y además el editor pide confirmación explícita en cada envío, mostrando el coste.
Ninguna imagen sale del equipo si no se cumplen las tres condiciones.

Precios por imagen generada (USD, solo salida; los tokens de la imagen de entrada se cobran
aparte), según https://developers.openai.com/api/docs/guides/image-generation y
https://developers.openai.com/api/docs/pricing (consultado el 31-10-2026). Verifica la página
oficial antes de usarlo: los precios y los modelos cambian.
"""
from __future__ import annotations

import base64
import io
import os

import numpy as np
from PIL import Image

PRECIOS = {
    "gpt-image-1-mini": {"low": {"1024x1024": 0.005, "1024x1536": 0.006, "1536x1024": 0.006},
                         "medium": {"1024x1024": 0.011, "1024x1536": 0.015, "1536x1024": 0.015},
                         "high": {"1024x1024": 0.036, "1024x1536": 0.052, "1536x1024": 0.052}},
    "gpt-image-1.5": {"low": {"1024x1024": 0.009, "1024x1536": 0.013, "1536x1024": 0.013},
                      "medium": {"1024x1024": 0.034, "1024x1536": 0.05, "1536x1024": 0.05},
                      "high": {"1024x1024": 0.133, "1024x1536": 0.2, "1536x1024": 0.2}},
    "gpt-image-2": {"low": {"1024x1024": 0.006, "1024x1536": 0.005, "1536x1024": 0.005},
                    "medium": {"1024x1024": 0.053, "1024x1536": 0.041, "1536x1024": 0.041},
                    "high": {"1024x1024": 0.211, "1024x1536": 0.165, "1536x1024": 0.165}},
}
ENDPOINT = "https://api.openai.com/v1/images/edits"


class NubeDesactivada(RuntimeError):
    pass


def config() -> dict:
    activada = os.environ.get("NUBE_ACTIVADA", "false").strip().lower() in {"1", "true", "si", "sí", "yes"}
    modelo = os.environ.get("NUBE_MODELO", "gpt-image-1-mini").strip()
    calidad = os.environ.get("NUBE_CALIDAD", "medium").strip()
    hay_clave = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    return {"activada": activada and hay_clave, "solicitada": activada, "hay_clave": hay_clave,
            "proveedor": "OpenAI (API oficial de imágenes)", "modelo": modelo, "calidad": calidad}


def tamano_para(w: int, h: int) -> str:
    r = w / max(1, h)
    if r > 1.2:
        return "1536x1024"
    if r < 0.83:
        return "1024x1536"
    return "1024x1024"


def coste(w: int, h: int) -> dict:
    c = config()
    tam = tamano_para(w, h)
    precio = PRECIOS.get(c["modelo"], {}).get(c["calidad"], {}).get(tam)
    return {"usd_por_imagen": precio, "tamano": tam, "modelo": c["modelo"], "calidad": c["calidad"],
            "nota": "Precio aproximado de la imagen generada; los tokens de la imagen enviada se cobran aparte."}


def _png(arr: np.ndarray) -> bytes:
    b = io.BytesIO()
    Image.fromarray(arr).save(b, "PNG")
    return b.getvalue()


def relleno_generativo(img: np.ndarray, mascara: np.ndarray | None, prompt: str, confirmado: bool) -> np.ndarray:
    """Envía la imagen (RGB) y la máscara (True = zona a generar) a la API. Devuelve RGB
    del mismo tamaño que la entrada. Lanza NubeDesactivada si no está permitido."""
    c = config()
    if not c["activada"]:
        raise NubeDesactivada("Las opciones en la nube están desactivadas (NUBE_ACTIVADA=false o falta OPENAI_API_KEY en .env).")
    if not confirmado:
        raise NubeDesactivada("Falta tu confirmación para enviar la imagen a la nube.")
    import httpx

    H, W = img.shape[:2]
    tam = tamano_para(W, H)
    tw, th = map(int, tam.split("x"))
    entrada = np.asarray(Image.fromarray(img).resize((tw, th), Image.LANCZOS))
    archivos = [("image[]", ("imagen.png", _png(entrada), "image/png"))]
    if mascara is not None:
        m = np.asarray(Image.fromarray(mascara.astype(np.uint8) * 255).resize((tw, th), Image.NEAREST)) > 127
        # convención de la API: las zonas transparentes de la máscara son las que se editan
        rgba = np.dstack([entrada, np.where(m, 0, 255).astype(np.uint8)])
        archivos.append(("mask", ("mascara.png", _png(rgba), "image/png")))
    datos = {"model": c["modelo"], "prompt": prompt[:4000], "size": tam, "quality": c["calidad"], "n": "1"}
    r = httpx.post(ENDPOINT, headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY'].strip()}"},
                   data=datos, files=archivos, timeout=180)
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", r.text[:300])
        except Exception:
            msg = r.text[:300]
        raise RuntimeError(f"El proveedor en la nube respondió {r.status_code}: {msg}")
    b64 = r.json()["data"][0]["b64_json"]
    out = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB").resize((W, H), Image.LANCZOS)
    out = np.asarray(out)
    if mascara is not None:  # conserva intactos los píxeles fuera de la máscara
        out = np.where(mascara[..., None], out, img)
    return out
