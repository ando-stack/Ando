"""Crea las imágenes de prueba en /test-images a partir de fotos de dominio público
(NASA, SpaceX) y CC0 (scikit-image), con textos y gráficos propios. Guarda junto a cada
imagen un JSON con la «verdad» (textos, fuentes, colores) para evaluar la descomposición.

Uso:  python scripts/crear_imagenes_prueba.py
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
DEST = RAIZ / "test-images"
FUENTES = RAIZ / "assets" / "fonts"
CACHE = RAIZ / "test-images" / "_fuentes_originales"

NASA = {  # id → descripción (todas son de dominio público)

    "KSC-2012-1695": ("estadio de béisbol, Space Coast Stadium (NASA/KSC, dominio público)"),
    "S84-40242": ("retrato oficial del astronauta Mark C. Lee (NASA/JSC, dominio público)"),
    "s90-38573": ("retrato oficial del astronauta Frank L. Culbertson (NASA/JSC, dominio público)"),
}


def foto_nasa(nasa_id: str) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / f"{nasa_id}.jpg"
    if not p.exists():
        url = f"https://images-assets.nasa.gov/image/{nasa_id}/{nasa_id}~medium.jpg"
        p.write_bytes(urllib.request.urlopen(url, timeout=60).read())
    return Image.open(p).convert("RGB")


def fuente(carpeta: str, archivo: str, tam: int, peso: int | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FUENTES / carpeta / archivo), tam)
    if peso is not None:
        ejes = f.get_variation_axes()
        f.set_variation_by_axes([peso if (e.get("name") in (b"Weight", "Weight")) else e["default"] for e in ejes])
    return f


def texto_rgba(texto, f, relleno="#ffffff", contornos=(), sombra=None, degradado=None) -> Image.Image:
    """Texto con relleno (o degradado vertical), varios contornos (de dentro a fuera) y sombra."""
    total = sum(w for _, w in contornos)
    sd = sombra or {}
    pad = total + abs(sd.get("dx", 0)) + abs(sd.get("dy", 0)) + 10
    l, t, r, b = f.getbbox(texto)
    im = Image.new("RGBA", (r + 2 * pad, b + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if sombra:
        d.text((pad + sombra["dx"], pad + sombra["dy"]), texto, font=f, fill=sombra["color"], stroke_width=total, stroke_fill=sombra["color"])
    acum = total
    for color, w in reversed(list(contornos)):
        d.text((pad, pad), texto, font=f, fill=color, stroke_width=acum, stroke_fill=color)
        acum -= w
    if degradado:
        m = Image.new("L", im.size, 0)
        ImageDraw.Draw(m).text((pad, pad), texto, font=f, fill=255)
        bb = m.getbbox()
        grad = Image.new("RGBA", im.size)
        c0, c1 = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in degradado]
        gd = ImageDraw.Draw(grad)
        for y in range(im.size[1]):
            tt = min(1, max(0, (y - bb[1]) / max(1, bb[3] - bb[1])))
            gd.line([(0, y), (im.size[0], y)], fill=tuple(int(c0[k] * (1 - tt) + c1[k] * tt) for k in range(3)) + (255,))
        im.paste(grad, (0, 0), m)
    else:
        d.text((pad, pad), texto, font=f, fill=relleno)
    return im


def pegar_girado(base: Image.Image, capa: Image.Image, centro, angulo: float):
    rot = capa.rotate(angulo, expand=True, resample=Image.BICUBIC)
    base.alpha_composite(rot, (int(centro[0] - rot.width / 2), int(centro[1] - rot.height / 2)))


def recorte_persona(foto: Image.Image) -> Image.Image:
    from engine import segment

    img = np.asarray(foto)
    dets = [d for d in segment.detectar(img, 0.5) if d.etiqueta == "person"]
    d = max(dets, key=lambda d: (d.caja[2] - d.caja[0]) * (d.caja[3] - d.caja[1]))
    m, _ = segment.sam_mascaras(img, cajas=[d.caja])[0]
    a = segment.afinar_alfa(img, segment.limpiar_mascara(m))
    rgba = np.dstack([img, (a * 255).astype(np.uint8)])
    im = Image.fromarray(rgba, "RGBA")
    return im.crop(im.getbbox())


def contorno_blanco(sujeto: Image.Image, ancho: int, color=(255, 255, 255, 255)) -> Image.Image:
    a = sujeto.split()[-1]
    pad = ancho + 2
    lienzo = Image.new("RGBA", (sujeto.width + 2 * pad, sujeto.height + 2 * pad))
    ag = Image.new("L", lienzo.size)
    ag.paste(a, (pad, pad))
    ag = ag.filter(ImageFilter.MaxFilter(ancho * 2 + 1)).point(lambda v: 255 if v > 60 else 0)
    lienzo.paste(Image.new("RGBA", lienzo.size, color), (0, 0), ag)
    lienzo.alpha_composite(sujeto, (pad, pad))
    return lienzo


def degradado_fondo(w, h, c0, c1, vertical=True) -> Image.Image:
    a = np.linspace(0, 1, h if vertical else w)
    c0, c1 = np.array(c0, float), np.array(c1, float)
    lin = (c0[None] * (1 - a[:, None]) + c1[None] * a[:, None]).astype(np.uint8)
    arr = np.repeat(lin[:, None], w, 1) if vertical else np.repeat(lin[None], h, 0)
    return Image.fromarray(arr).convert("RGBA")


def guardar(nombre, im: Image.Image, verdad: dict, formato="JPEG"):
    DEST.mkdir(exist_ok=True)
    ruta = DEST / nombre
    if formato == "JPEG":
        im.convert("RGB").save(ruta, quality=90)
    elif formato == "WEBP":
        im.convert("RGB").save(ruta, quality=90)
    else:
        im.convert("RGB").save(ruta)
    verdad["archivo"] = nombre
    verdad["tamano"] = list(im.size)
    (DEST / (Path(nombre).stem + ".json")).write_text(json.dumps(verdad, ensure_ascii=False, indent=1), "utf-8")
    print("OK", nombre)


def main():
    import skimage.data as sk

    lee = recorte_persona(foto_nasa("S84-40242"))
    culb = recorte_persona(foto_nasa("s90-38573"))
    collins = recorte_persona(Image.fromarray(sk.astronaut()))

    # 1. Miniatura de reacción ---------------------------------------------------
    W, H = 1280, 720
    est = foto_nasa("KSC-2012-1695").resize((W, int(W * 853 / 1280))).crop((0, 40, W, 40 + H))
    im = est.filter(ImageFilter.GaussianBlur(2)).convert("RGBA")
    im = Image.blend(im, Image.new("RGBA", im.size, (10, 10, 30, 255)), 0.25)
    s = lee.resize((int(lee.width * 640 / lee.height), 640))
    s = contorno_blanco(s, 10)
    im.alpha_composite(s, (W - s.width - 20, H - s.height + 10))
    t1 = texto_rgba("¡NO ME LO CREO!", fuente("anton", "Anton-Regular.ttf", 120), "#ffe600", [("#000000", 10)])
    pegar_girado(im, t1, (430, 150), 4)
    d = ImageDraw.Draw(im)
    d.ellipse((60, 470, 260, 670), fill="#e3122c")
    t2 = texto_rgba("NUEVO", fuente("russoone", "RussoOne-Regular.ttf", 44), "#ffffff")
    pegar_girado(im, t2, (160, 570), 0)
    guardar("01_miniatura_reaccion.jpg", im, {
        "descripcion": "Miniatura de YouTube con cara, texto grande con contorno y círculo gráfico",
        "textos": [
            {"texto": "¡NO ME LO CREO!", "familia": "Anton", "relleno": "#ffe600", "contornos": [{"color": "#000000", "ancho": 10}], "angulo": -4},
            {"texto": "NUEVO", "familia": "Russo One", "relleno": "#ffffff", "contornos": [], "angulo": 0},
        ],
        "sujetos": 1, "graficos": ["círculo rojo"],
        "fuentes_imagen": ["NASA KSC-2012-1695", "NASA S84-40242"],
    })

    # 2. Póster deportivo 4:5 ---------------------------------------------------
    W, H = 1080, 1350
    im = degradado_fondo(W, H, (12, 20, 60), (2, 4, 12))
    d = ImageDraw.Draw(im)
    d.polygon([(0, 820), (W, 560), (W, 760), (0, 1020)], fill="#ff6a00")
    d.rectangle((0, 1220, W, H), fill="#ffd400")
    s = culb.resize((int(culb.width * 900 / culb.height), 900))
    im.alpha_composite(s, ((W - s.width) // 2, 330))
    t = texto_rgba("GAME DAY", fuente("bebasneue", "BebasNeue-Regular.ttf", 230), "#ffffff", sombra={"dx": 12, "dy": 12, "color": "#e3122c"})
    pegar_girado(im, t, (W / 2, 190), 0)
    t = texto_rgba("SÁBADO 20:00", fuente("oswald", "Oswald[wght].ttf", 70, 700), "#101010")
    pegar_girado(im, t, (W / 2, 1290), 0)
    guardar("02_poster_deportivo.png", im, {
        "descripcion": "Póster deportivo 4:5 con jugador recortado, banda diagonal y franja inferior",
        "textos": [
            {"texto": "GAME DAY", "familia": "Bebas Neue", "relleno": "#ffffff", "contornos": [], "sombra": {"color": "#e3122c", "dx": 12, "dy": 12}, "angulo": 0},
            {"texto": "SÁBADO 20:00", "familia": "Oswald", "relleno": "#101010", "contornos": [], "angulo": 0},
        ],
        "sujetos": 1, "graficos": ["banda diagonal naranja", "franja amarilla"],
        "fuentes_imagen": ["NASA s90-38573"],
    }, formato="PNG")

    # 3. Fondo complejo ----------------------------------------------------------
    roc = Image.fromarray(sk.rocket()).resize((1280, 854), Image.LANCZOS).convert("RGBA")
    im = roc
    t = texto_rgba("DESPEGUE HISTÓRICO", fuente("montserrat", "Montserrat[wght].ttf", 92, 900), "#ffffff", [("#000000", 6)])
    pegar_girado(im, t, (640, 110), 0)
    d = ImageDraw.Draw(im)
    d.rectangle((60, 700, 380, 790), fill="#d0021b")
    t = texto_rgba("EN DIRECTO", fuente("oswald", "Oswald[wght].ttf", 56, 700), "#ffffff")
    pegar_girado(im, t, (220, 745), 0)
    guardar("03_fondo_complejo.jpg", im, {
        "descripcion": "Foto de fondo complejo (lanzamiento) con titular y rótulo",
        "textos": [
            {"texto": "DESPEGUE HISTÓRICO", "familia": "Montserrat", "relleno": "#ffffff", "contornos": [{"color": "#000000", "ancho": 6}], "angulo": 0},
            {"texto": "EN DIRECTO", "familia": "Oswald", "relleno": "#ffffff", "contornos": [], "angulo": 0},
        ],
        "sujetos": 0, "graficos": ["rectángulo rojo"],
        "fuentes_imagen": ["SpaceX (dominio público) vía scikit-image"],
    })

    # 4. Textos rotados ------------------------------------------------------------
    W, H = 1280, 720
    im = degradado_fondo(W, H, (60, 20, 120), (10, 60, 160), vertical=False)
    ruido = (np.random.default_rng(3).normal(0, 6, (H, W, 1)).repeat(3, 2))
    im = Image.fromarray((np.asarray(im)[..., :3] + ruido).clip(0, 255).astype(np.uint8)).convert("RGBA")
    pegar_girado(im, texto_rgba("TOP 10", fuente("bangers", "Bangers-Regular.ttf", 190), "#ffe600", [("#000000", 8)]), (330, 220), 15)
    pegar_girado(im, texto_rgba("JUGADAS", fuente("russoone", "RussoOne-Regular.ttf", 110), "#ffffff", [("#e3122c", 7)]), (860, 300), -10)
    pegar_girado(im, texto_rgba("DE LA TEMPORADA", fuente("teko", "Teko[wght].ttf", 100, 600), "#00e5ff"), (640, 560), 6)
    d = ImageDraw.Draw(im)
    d.polygon([(1040, 520), (1180, 520), (1180, 480), (1260, 570), (1180, 660), (1180, 620), (1040, 620)], fill="#ffe600")
    guardar("04_textos_rotados.webp", im, {
        "descripcion": "Varios textos girados con distintas fuentes, contornos y una flecha",
        "textos": [
            {"texto": "TOP 10", "familia": "Bangers", "relleno": "#ffe600", "contornos": [{"color": "#000000", "ancho": 8}], "angulo": -15},
            {"texto": "JUGADAS", "familia": "Russo One", "relleno": "#ffffff", "contornos": [{"color": "#e3122c", "ancho": 7}], "angulo": 10},
            {"texto": "DE LA TEMPORADA", "familia": "Teko", "relleno": "#00e5ff", "contornos": [], "angulo": -6},
        ],
        "sujetos": 0, "graficos": ["flecha amarilla"],
        "fuentes_imagen": [],
    }, formato="WEBP")

    # 5. Dos caras VS --------------------------------------------------------------
    W, H = 1280, 720
    im = Image.new("RGBA", (W, H), "#1d4ed8")
    ImageDraw.Draw(im).polygon([(0, 0), (700, 0), (580, H), (0, H)], fill="#dc2626")
    a = collins.resize((int(collins.width * 600 / collins.height), 600))
    b = lee.resize((int(lee.width * 600 / lee.height), 600)).transpose(Image.FLIP_LEFT_RIGHT)
    im.alpha_composite(contorno_blanco(a, 8), (10, H - 600))
    im.alpha_composite(contorno_blanco(b, 8), (W - b.width - 30, H - 600))
    vs = texto_rgba("VS", fuente("bowlbyone", "BowlbyOne-Regular.ttf", 200), "#ffe600", [("#000000", 8), ("#ffffff", 8)])
    pegar_girado(im, vs, (640, 380), 0)
    guardar("05_dos_caras_vs.jpg", im, {
        "descripcion": "Miniatura «VS» con dos caras recortadas con contorno blanco y texto con doble contorno",
        "textos": [{"texto": "VS", "familia": "Bowlby One", "relleno": "#ffe600", "contornos": [{"color": "#000000", "ancho": 8}, {"color": "#ffffff", "ancho": 8}], "angulo": 0}],
        "sujetos": 2, "graficos": ["mitad roja diagonal"],
        "fuentes_imagen": ["NASA (Eileen Collins) vía scikit-image", "NASA S84-40242"],
    })

    # 6. Producto con degradado -----------------------------------------------------
    W, H = 1080, 1080
    caf = Image.fromarray(sk.coffee()).convert("RGBA")
    caf = caf.resize((int(caf.width * H / caf.height), H), Image.LANCZOS).crop((300, 0, 300 + W, H))
    im = caf
    t = texto_rgba("EL MEJOR CAFÉ", fuente("alfaslabone", "AlfaSlabOne-Regular.ttf", 110), degradado=["#ffb000", "#e3122c"], contornos=[("#ffffff", 6)])
    pegar_girado(im, t, (W / 2, 140), 0)
    t = texto_rgba("¿LO PROBARÍAS?", fuente("poppins", "Poppins-Black.ttf", 80), "#ffffff", [("#3b1d0f", 6)])
    pegar_girado(im, t, (W / 2, 960), 0)
    guardar("06_producto.jpg", im, {
        "descripcion": "Producto (taza) con texto en degradado y signos de interrogación",
        "textos": [
            {"texto": "EL MEJOR CAFÉ", "familia": "Alfa Slab One", "degradado": ["#ffb000", "#e3122c"], "contornos": [{"color": "#ffffff", "ancho": 6}], "angulo": 0},
            {"texto": "¿LO PROBARÍAS?", "familia": "Poppins", "relleno": "#ffffff", "contornos": [{"color": "#3b1d0f", "ancho": 6}], "angulo": 0},
        ],
        "sujetos": 1, "graficos": [],
        "fuentes_imagen": ["Rachel Michetti, CC0, vía scikit-image"],
    })

    # 7. Mascota (objeto no humano) ----------------------------------------------------
    W, H = 1280, 720
    gato = Image.fromarray(sk.chelsea()).convert("RGBA").resize((1080, 720), Image.LANCZOS)
    im = Image.new("RGBA", (W, H), "#111827")
    im.alpha_composite(gato, (200, 0))
    ImageDraw.Draw(im).rectangle((0, 0, 360, H), fill="#facc15")
    pegar_girado(im, texto_rgba("¿QUIÉN", fuente("archivoblack", "ArchivoBlack-Regular.ttf", 84), "#111827"), (180, 300), 90 - 90)
    pegar_girado(im, texto_rgba("GANA?", fuente("archivoblack", "ArchivoBlack-Regular.ttf", 84), "#111827"), (180, 410), 0)
    guardar("07_mascota.png", im, {
        "descripcion": "Mascota sobre foto con franja lateral de color y texto en dos líneas",
        "textos": [
            {"texto": "¿QUIÉN", "familia": "Archivo Black", "relleno": "#111827", "contornos": [], "angulo": 0},
            {"texto": "GANA?", "familia": "Archivo Black", "relleno": "#111827", "contornos": [], "angulo": 0},
        ],
        "sujetos": 1, "graficos": ["franja amarilla"],
        "fuentes_imagen": ["Stefan van der Walt, CC0, vía scikit-image"],
    }, formato="PNG")


if __name__ == "__main__":
    main()
