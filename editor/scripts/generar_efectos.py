"""Genera por procedimiento las superposiciones y texturas de /assets (obra propia, CC0):
destellos y luces, rayos, humo, grano y semitono. No usa imágenes de terceros.

Uso:  python scripts/generar_efectos.py
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parents[1]
OV = RAIZ / "assets" / "overlays"
TX = RAIZ / "assets" / "textures"
W, H = 1920, 1080
rng = np.random.default_rng(2026)


def guardar(arr: np.ndarray, ruta: Path, calidad: int = 88):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if ruta.suffix == ".jpg":
        im.convert("RGB").save(ruta, quality=calidad, optimize=True)
    else:
        im.save(ruta, optimize=True)
    print("OK", ruta.relative_to(RAIZ))


def ruido_fractal(h, w, octavas=6, semilla=0):
    r = np.random.default_rng(semilla)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octavas):
        s = 2 ** (o + 2)
        base = r.random((s, int(s * w / h) + 1), dtype=np.float32)
        out += cv2.resize(base, (w, h), interpolation=cv2.INTER_CUBIC) * amp
        total += amp
        amp *= 0.5
    out /= total
    return (out - out.min()) / (out.max() - out.min() + 1e-6)


def destello():
    """Destello de lente con halo y anillos sobre negro (usar con modo «Trama»)."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W * 0.7, H * 0.3
    d = np.hypot(x - cx, y - cy)
    img = np.zeros((H, W, 3), np.float32)
    nucleo = np.exp(-(d / 40) ** 2)[..., None] * [255, 250, 235]
    halo = np.exp(-(d / 260) ** 2)[..., None] * [255, 170, 80] * 0.7
    estrella = (np.exp(-((y - cy) / 3) ** 2) * np.exp(-((x - cx) / 700) ** 2))[..., None] * [255, 230, 200]
    img += nucleo + halo + estrella
    # anillos a lo largo del eje hacia el centro
    for t, r, col in [(0.6, 60, [80, 160, 255]), (1.1, 25, [255, 120, 60]), (1.5, 90, [120, 255, 160]), (1.9, 40, [255, 220, 120])]:
        px, py = cx + (W / 2 - cx) * t, cy + (H / 2 - cy) * t
        dd = np.hypot(x - px, y - py)
        img += (np.exp(-((dd - r) / 6) ** 2) * 0.35 + np.exp(-(dd / r) ** 2) * 0.15)[..., None] * col
    guardar(img, OV / "destello_lente.jpg")


def luces_bokeh():
    img = np.zeros((H, W, 3), np.float32)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    cols = [[255, 180, 60], [255, 90, 60], [80, 160, 255], [255, 230, 150]]
    for _ in range(70):
        cx, cy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(15, 90)
        c = np.array(cols[rng.integers(len(cols))], np.float32)
        d = np.hypot(x - cx, y - cy)
        disco = np.clip((r - d) / 3, 0, 1) * rng.uniform(0.15, 0.5)
        img += disco[..., None] * c
    img = cv2.GaussianBlur(img, (0, 0), 2)
    guardar(img, OV / "luces_bokeh.jpg")


def rayos_luz():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W * 0.5, -H * 0.15
    ang = np.arctan2(y - cy, x - cx)
    rayos = (0.5 + 0.5 * np.sin(ang * 38)) ** 6 + 0.6 * (0.5 + 0.5 * np.sin(ang * 13 + 1.3)) ** 8
    caida = np.exp(-np.hypot(x - cx, y - cy) / (H * 1.1))
    v = rayos * caida
    v = cv2.GaussianBlur(v, (0, 0), 3)
    img = v[..., None] * [255, 240, 210] * 1.3
    guardar(img, OV / "rayos_de_luz.jpg")


def humo():
    n = ruido_fractal(H, W, 7, 5)
    n2 = ruido_fractal(H, W, 5, 9)
    v = np.clip((n * 0.7 + n2 * 0.3 - 0.45) * 2.4, 0, 1) ** 1.6
    y = np.linspace(1, 0.2, H)[:, None]
    v = v * y
    img = v[..., None] * [235, 235, 240]
    guardar(img, OV / "humo.jpg")


def chispas():
    img = np.zeros((H, W, 3), np.float32)
    for _ in range(400):
        x0, y0 = rng.uniform(0, W), rng.uniform(H * 0.3, H)
        largo, ang = rng.uniform(10, 60), rng.uniform(-2.0, -1.1)
        x1, y1 = x0 + np.cos(ang) * largo, y0 + np.sin(ang) * largo
        c = (int(rng.uniform(150, 255)), int(rng.uniform(80, 180)), 30)
        cv2.line(img, (int(x0), int(y0)), (int(x1), int(y1)), c, int(rng.integers(1, 3)), cv2.LINE_AA)
    img = img + cv2.GaussianBlur(img, (0, 0), 4) * 1.5
    guardar(img, OV / "chispas.jpg")


def grano():
    g = rng.normal(128, 38, (1080, 1080)).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 0.6)
    guardar(np.dstack([g] * 3), TX / "grano.jpg", 82)


def semitono():
    paso = 12
    s = 1080
    y, x = np.mgrid[0:s, 0:s].astype(np.float32)
    # rejilla girada 45° con puntos que crecen en diagonal
    xr = (x + y) / np.sqrt(2)
    yr = (x - y) / np.sqrt(2)
    fx = (xr % paso) - paso / 2
    fy = (yr % paso) - paso / 2
    radio = (0.15 + 0.85 * (x + y) / (2 * s)) * paso * 0.5
    v = np.where(np.hypot(fx, fy) < radio, 40, 200).astype(np.float32)
    v = cv2.GaussianBlur(v, (0, 0), 0.7)
    guardar(np.dstack([v] * 3), TX / "semitono.png")


def papel():
    n = ruido_fractal(1080, 1080, 7, 3)
    v = 150 + (n - 0.5) * 60 + rng.normal(0, 6, (1080, 1080))
    guardar(np.dstack([v] * 3), TX / "textura_papel.jpg", 82)


if __name__ == "__main__":
    destello()
    luces_bokeh()
    rayos_luz()
    humo()
    chispas()
    grano()
    semitono()
    papel()
