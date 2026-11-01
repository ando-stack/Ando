"""Texto: OCR (PP-OCRv6 vía RapidOCR), análisis de estilo (relleno, degradado, contornos,
sombra), identificación aproximada de la fuente contra la biblioteca libre y comprobación
de fidelidad de la reconstrucción."""
from __future__ import annotations

import json
import logging
import math
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .models import registry as reg

log = logging.getLogger("estudio")
RAIZ = Path(__file__).resolve().parents[1]
FUENTES = RAIZ / "assets" / "fonts"
_cerrojo = threading.RLock()
_ocr = {"motor": None}
DEPURAR: dict = {}


# ------------------------------------------------------------------ OCR

def _motor_ocr():
    with _cerrojo:
        if _ocr["motor"] is None:
            from rapidocr import ModelType, RapidOCR

            params = {"Global.log_level": "error", "Global.text_score": 0.35, "Rec.lang_type": "es", "Det.lang_type": "es"}
            if reg.disponible("ocr_det") and reg.disponible("ocr_rec"):
                params.update({
                    "Det.model_type": ModelType.MEDIUM,
                    "Rec.model_type": ModelType.MEDIUM,
                    "Det.model_path": str(reg.ruta_local(reg.MODELOS["ocr_det"])),
                    "Rec.model_path": str(reg.ruta_local(reg.MODELOS["ocr_rec"])),
                })
            else:  # modelos «small» incluidos en el paquete rapidocr (sin descarga)
                params.update({"Det.model_type": ModelType.SMALL, "Rec.model_type": ModelType.SMALL})
            _ocr["motor"] = RapidOCR(params=params)
        return _ocr["motor"]


@dataclass
class LineaOCR:
    texto: str
    puntuacion: float
    quad: np.ndarray  # 4x2 (sup-izq, sup-der, inf-der, inf-izq)


def leer_texto(img: np.ndarray) -> list[LineaOCR]:
    """Detecta y lee las líneas de texto de una imagen RGB."""
    motor = _motor_ocr()
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    r = motor(bgr)
    if r is None or r.boxes is None:
        return []
    out = []
    for q, t, s in zip(r.boxes, r.txts, r.scores):
        t = (t or "").strip()
        if not t:
            continue
        out.append(LineaOCR(t, float(s), _ordenar_quad(np.asarray(q, np.float32))))
    return out


def _ordenar_quad(q: np.ndarray) -> np.ndarray:
    """Ordena los 4 vértices: sup-izq, sup-der, inf-der, inf-izq (según el eje largo)."""
    c = q.mean(0)
    ang = np.arctan2(q[:, 1] - c[1], q[:, 0] - c[0])
    q = q[np.argsort(ang)]  # orden angular desde -pi
    # elige como primer vértice el que tenga menor x+y para mantener la orientación de lectura
    i = int(np.argmin(q[:, 0] + q[:, 1]))
    q = np.roll(q, -i, axis=0)
    if np.linalg.norm(q[1] - q[0]) < np.linalg.norm(q[3] - q[0]) * 0.6:
        # el lado «superior» es en realidad vertical (texto muy girado): rota el orden
        q = np.roll(q, 1, axis=0)
    return q


# ------------------------------------------------------------------ biblioteca de fuentes

@dataclass(frozen=True)
class VarianteFuente:
    familia: str
    peso: int
    archivo: Path
    variable: bool
    categoria: str


@lru_cache(maxsize=1)
def biblioteca() -> list[VarianteFuente]:
    manifest = json.loads((FUENTES / "manifest.json").read_text("utf-8"))
    out = []
    for fam in manifest:
        for fi in fam["ficheros"]:
            ruta = FUENTES / fi["archivo"]
            if not ruta.exists():
                continue
            if fi["variable"]:
                for p in fam["pesos"]:
                    out.append(VarianteFuente(fam["familia"], p, ruta, True, fam["categoria"]))
            else:
                out.append(VarianteFuente(fam["familia"], fi["peso"], ruta, False, fam["categoria"]))
    return out


def manifiesto_web() -> list[dict]:
    """Datos de la biblioteca para el editor (rutas relativas a /assets/fonts)."""
    manifest = json.loads((FUENTES / "manifest.json").read_text("utf-8"))
    return [
        {
            "familia": f["familia"],
            "categoria": f["categoria"],
            "licencia": f["licencia"],
            "disenador": f["disenador"],
            "ficheros": [{"url": f"/assets/fonts/{x['archivo']}", "peso": x["peso"], "variable": x["variable"]} for x in f["ficheros"]],
        }
        for f in manifest
    ]


@lru_cache(maxsize=512)
def _fuente(archivo: str, peso: int, variable: bool, tam: int) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(archivo, tam)
    if variable:
        try:
            ejes = f.get_variation_axes()
            valores = []
            for e in ejes:
                nombre = e.get("name", b"")
                nombre = nombre.decode() if isinstance(nombre, bytes) else str(nombre)
                if nombre.lower().startswith("weight") or nombre.lower() == "wght":
                    valores.append(int(np.clip(peso, e["minimum"], e["maximum"])))
                else:
                    valores.append(e["default"])
            f.set_variation_by_axes(valores)
        except Exception:  # pragma: no cover - fuentes sin ejes
            pass
    return f


def fuente_de(familia: str, peso: int, tam: int) -> ImageFont.FreeTypeFont:
    cand = [v for v in biblioteca() if v.familia == familia]
    if not cand:
        cand = biblioteca()[:1]
    v = min(cand, key=lambda c: abs(c.peso - peso))
    return _fuente(str(v.archivo), peso, v.variable, max(4, int(round(tam))))


def renderizar_linea(texto: str, f: ImageFont.FreeTypeFont, espaciado: float = 0.0, trazo: int = 0) -> tuple[np.ndarray, tuple[int, int]]:
    """Máscara (uint8) del texto con su origen (x, y) de dibujo dentro de la máscara.
    El origen es la esquina sup-izq de la caja de línea (ascendente) como en el editor."""
    asc, desc = f.getmetrics()
    ancho = int(sum(f.getlength(c) for c in texto) + max(0, len(texto) - 1) * max(espaciado, 0) + f.size)
    pad = trazo + 4
    im = Image.new("L", (max(1, ancho + 2 * pad), asc + desc + 2 * pad), 0)
    d = ImageDraw.Draw(im)
    if abs(espaciado) < 0.01:
        d.text((pad, pad), texto, font=f, fill=255, stroke_width=trazo, stroke_fill=255)
    else:
        x = pad
        for c in texto:
            d.text((x, pad), c, font=f, fill=255, stroke_width=trazo, stroke_fill=255)
            x += f.getlength(c) + espaciado
    return np.asarray(im), (pad, pad)


def _bbox(m: np.ndarray):
    ys, xs = np.nonzero(m > 127 if m.dtype == np.uint8 else m)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def comparar_fuentes(texto: str, objetivo: np.ndarray, top: int = 3) -> list[dict]:
    """Compara la forma `objetivo` (máscara binaria del relleno, ya enderezada) con el
    texto renderizado en cada fuente de la biblioteca. Devuelve las `top` más parecidas."""
    bb = _bbox(objetivo)
    if bb is None:
        return []
    t = objetivo[bb[1]:bb[3], bb[0]:bb[2]].astype(np.float32)
    if t.max() > 1:
        t = t / 255.0
    H = 40
    ar_t = t.shape[1] / max(1, t.shape[0])
    W = int(np.clip(H * ar_t, 8, 1200))
    tn = cv2.resize(t, (W, H), interpolation=cv2.INTER_AREA)
    tn_s = cv2.GaussianBlur(tn, (0, 0), 1.0)
    resultados = []
    vistos = set()
    for v in biblioteca():
        f = _fuente(str(v.archivo), v.peso, v.variable, 64)
        m, _ = renderizar_linea(texto, f)
        b = _bbox(m)
        if b is None:
            continue
        r = m[b[1]:b[3], b[0]:b[2]].astype(np.float32) / 255.0
        ar_r = r.shape[1] / max(1, r.shape[0])
        rn = cv2.resize(r, (W, H), interpolation=cv2.INTER_AREA)
        rn_s = cv2.GaussianBlur(rn, (0, 0), 1.0)
        inter = np.minimum(tn_s, rn_s).sum()
        union = np.maximum(tn_s, rn_s).sum() + 1e-6
        iou = inter / union
        # densidad de tinta (grosor del trazo) y proporción (condensada/ancha)
        dens = 1 - min(1.0, abs(tn.mean() - rn.mean()) / max(0.05, tn.mean()))
        prop = math.exp(-2.5 * abs(math.log(ar_t / max(ar_r, 1e-3))))
        score = float(iou * 0.6 + dens * 0.15 + prop * 0.25)
        clave = (v.familia, v.peso)
        if clave in vistos:
            continue
        vistos.add(clave)
        resultados.append({"familia": v.familia, "peso": v.peso, "puntuacion": round(score, 4)})
    resultados.sort(key=lambda x: -x["puntuacion"])
    # una sola entrada por familia en el top
    top_res, fams = [], set()
    for r in resultados:
        if r["familia"] in fams:
            continue
        fams.add(r["familia"])
        top_res.append(r)
        if len(top_res) == top:
            break
    return top_res


# ------------------------------------------------------------------ análisis de estilo

def _hex(c) -> str:
    c = np.clip(np.asarray(c, np.float32), 0, 255).round().astype(int)
    return "#{:02x}{:02x}{:02x}".format(*c[:3])


def _lab_dist(a, b) -> float:
    la = cv2.cvtColor(np.uint8([[a]]), cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)
    lb = cv2.cvtColor(np.uint8([[b]]), cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)
    return float(np.linalg.norm(la - lb))


@dataclass
class EstiloTexto:
    texto: str
    puntuacion_ocr: float
    angulo: float  # grados, sentido horario (como el editor)
    relleno: str
    degradado: list[str] | None
    contornos: list[dict]  # [{color, ancho}] de dentro a fuera
    sombra: dict | None  # {color, dx, dy, desenfoque, opacidad}
    fuentes: list[dict]
    familia: str
    peso: int
    tam_fuente: float
    espaciado: float
    caja_tinta: dict  # {x, y, w, h} de la tinta del relleno en coords. de la imagen (esquina sup-izq girada)
    mascara: np.ndarray  # máscara completa (relleno+contornos+sombra) en coords. de la imagen
    mascara_relleno_contorno: np.ndarray
    fidelidad: float = 0.0
    avisos: list[str] = field(default_factory=list)


def _enderezar(img: np.ndarray, quad: np.ndarray, pad_rel: float = 0.45):
    """Recorte enderezado de la línea con margen. Devuelve (recorte, M, Minv, rect_quad)."""
    q = quad.astype(np.float32)
    ancho = float((np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2)
    alto = float((np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2)
    pad = max(6.0, alto * pad_rel)
    W, H = int(round(ancho + 2 * pad)), int(round(alto + 2 * pad))
    dst = np.float32([[pad, pad], [pad + ancho, pad], [pad + ancho, pad + alto], [pad, pad + alto]])
    M = cv2.getPerspectiveTransform(q, dst)
    Minv = cv2.getPerspectiveTransform(dst, q)
    crop = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return crop, M, Minv, (pad, pad, ancho, alto)


def _clusters(crop: np.ndarray, k: int = 5):
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    n = lab.shape[0]
    idx = np.random.default_rng(0).choice(n, size=min(n, 20000), replace=False)
    k = int(min(k, max(2, len(np.unique(lab[idx], axis=0)))))
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    cv2.setRNGSeed(0)
    _, _, centros = cv2.kmeans(lab[idx], k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    d = ((lab[:, None, :] - centros[None]) ** 2).sum(-1)
    etiquetas = d.argmin(1).reshape(crop.shape[:2])
    # fusiona centros muy parecidos (ΔE < 14)
    mapa = list(range(k))
    for i in range(k):
        for j in range(i):
            if np.linalg.norm(centros[i] - centros[j]) < 14 and mapa[j] == j:
                mapa[i] = j
                break
    etiquetas = np.array(mapa)[etiquetas]
    return etiquetas, sorted(set(mapa))


def analizar_linea(img: np.ndarray, linea: LineaOCR) -> EstiloTexto | None:
    """Analiza una línea; si el método por color da poca fidelidad, prueba el método por
    contorno cerrado y se queda con el mejor."""
    e1 = _analizar_linea(img, linea, "color")
    if e1 is not None and e1.fidelidad >= 0.6:
        return e1
    try:
        e2 = _analizar_linea(img, linea, "contorno")
    except Exception:
        log.exception("Método por contorno falló")
        e2 = None
    if e2 is not None and (e1 is None or e2.fidelidad > e1.fidelidad + 0.05):
        return e2
    return e1


def _relleno_por_contorno(etiquetas, ids, cercania, interior, alto, px, py, ancho):
    """Busca un color que forme contornos finos y cerrados alrededor de las letras y
    devuelve el interior encerrado como relleno."""
    mejor, puntos = None, 0.0
    area_caja = interior.sum()
    for c in ids:
        m = ((etiquetas == c) & cercania).astype(np.uint8)
        if m.sum() < 30:
            continue
        d = cv2.distanceTransform(m, cv2.DIST_L2, 3)
        grosor = float(d[m > 0].mean()) * 2
        if grosor > alto * 0.18:
            continue  # no es una línea fina
        inv = (1 - m).astype(np.uint8)
        n, lab, st, cen = cv2.connectedComponentsWithStats(inv, 4)
        huecos = np.zeros_like(m, dtype=bool)
        H, W = m.shape
        for i in range(1, n):
            x, y, w, h, a = st[i]
            if x == 0 or y == 0 or x + w >= W or y + h >= H:
                continue
            if a < 15 or h < alto * 0.2:
                continue
            cx, cy = cen[i]
            if px <= cx <= px + ancho and py - alto * 0.2 <= cy <= py + alto * 1.2:
                huecos |= lab == i
        frac = (huecos & interior).sum() / max(1, area_caja)
        if frac > puntos and frac > 0.12:
            mejor, puntos = (huecos, c), frac
    return mejor


def _analizar_linea(img: np.ndarray, linea: LineaOCR, metodo: str) -> EstiloTexto | None:
    crop, M, Minv, (px, py, ancho, alto) = _enderezar(img, linea.quad)
    Hc, Wc = crop.shape[:2]
    etiquetas, ids = _clusters(crop, k=6)
    # regiones: interior (caja OCR) y anillo exterior (borde del recorte)
    interior = np.zeros((Hc, Wc), bool)
    interior[int(py):int(py + alto), int(px):int(px + ancho)] = True
    anillo = np.zeros((Hc, Wc), bool)
    b = max(2, int(min(px, py) * 0.5))
    anillo[:b, :] = anillo[-b:, :] = True
    anillo[:, :b] = anillo[:, -b:] = True
    cercania = np.zeros((Hc, Wc), bool)  # interior ampliado (para contornos/sombra que sobresalen)
    m = int(alto * 0.3)
    cercania[max(0, int(py) - m):int(py + alto) + m, max(0, int(px) - m):int(px + ancho) + m] = True

    info = []
    for c in ids:
        mc = etiquetas == c
        p_in = float(mc[interior].mean())
        p_bd = float(mc[anillo].mean())
        info.append((c, p_in, p_bd, p_in / (p_bd + 0.03) * math.sqrt(p_in)))
    fondo = max(info, key=lambda x: x[2])[0]
    # fondo local: lo que domina el borde de la caja OCR (los glifos casi nunca lo tocan)
    mq = max(2, int(alto * 0.1))
    borde_caja = np.zeros((Hc, Wc), bool)
    borde_caja[max(0, int(py) - mq):int(py + alto) + mq, max(0, int(px) - mq):int(px + ancho) + mq] = True
    borde_caja[int(py) + mq:int(py + alto) - mq, int(px) + mq:int(px + ancho) - mq] = False
    v_b, c_b = np.unique(etiquetas[borde_caja], return_counts=True)
    fondo_local = int(v_b[np.argmax(c_b)]) if len(v_b) else fondo
    cand = [x for x in info if x[1] > 0.02 and x[0] != fondo_local]
    if not cand:
        return None
    c_relleno = max(cand, key=lambda x: x[3])[0]
    fill_mask = ((etiquetas == c_relleno) & cercania).astype(np.uint8)
    fill_mask = cv2.morphologyEx(fill_mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # conserva solo componentes cuyo centro cae dentro de la caja OCR
    n, lab, st, cen = cv2.connectedComponentsWithStats(fill_mask, 8)
    limpio = np.zeros_like(fill_mask)
    for i in range(1, n):
        cx, cy = cen[i]
        if px - 2 <= cx <= px + ancho + 2 and py - 2 <= cy <= py + alto + 2 and st[i, cv2.CC_STAT_AREA] >= 4:
            limpio[lab == i] = 1
    fill_mask = cv2.morphologyEx(limpio, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
    if fill_mask.sum() < 20:
        return None
    fill_mask = _fusionar_degradado(fill_mask, etiquetas, cercania, [c for c, *_ in cand if c != c_relleno], alto)
    fill_mask = _filtrar_por_contorno(fill_mask, etiquetas, cercania, alto)
    if metodo == "contorno":
        r = _relleno_por_contorno(etiquetas, ids, cercania, interior, alto, px, py, ancho)
        if r is None:
            return None
        fill_mask = cv2.morphologyEx(r[0].astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
    if fill_mask.sum() < 20:
        return None
    rgb_relleno = np.median(crop[fill_mask], 0)

    # contornos: anillos concéntricos de un mismo color alrededor del relleno
    contornos = []
    acumulado = fill_mask.copy()
    max_d = max(3, int(alto * 0.35))
    for _ in range(3):
        D = cv2.distanceTransform((~acumulado).astype(np.uint8), cv2.DIST_L2, 3)
        r1 = (D > 1.5) & (D <= 3.5) & cercania
        if r1.sum() < 10:
            break
        valores, cuentas = np.unique(etiquetas[r1], return_counts=True)
        c = int(valores[np.argmax(cuentas)])
        frac = cuentas.max() / r1.sum()
        if frac < 0.55:
            break
        ancho_c = 0
        for d in range(2, max_d + 1):
            anillo_d = (D > d - 1) & (D <= d) & cercania
            if anillo_d.sum() == 0 or (etiquetas[anillo_d] == c).mean() < 0.5:
                break
            ancho_c = d
        if ancho_c >= max_d or ancho_c < 1:  # se extiende sin fin: es el fondo, no un contorno
            break
        zona = (D <= ancho_c) & (etiquetas == c) & cercania
        rgb = np.median(crop[zona], 0) if zona.sum() > 5 else rgb_relleno
        if contornos and _lab_dist(rgb, [int(contornos[-1]["color"][i:i + 2], 16) for i in (1, 3, 5)]) < 12:
            break
        contornos.append({"color": _hex(rgb), "ancho": float(ancho_c)})
        acumulado = acumulado | (D <= ancho_c)

    # sombra: píxeles de un color distinto del fondo, pegados a un lado del conjunto
    sombra_d = None
    mascara_total = acumulado.copy()
    D = cv2.distanceTransform((~acumulado).astype(np.uint8), cv2.DIST_L2, 3)
    zona_s = (D > 0) & (D < alto * 0.4) & cercania
    if zona_s.sum() > 20:
        valores, cuentas = np.unique(etiquetas[zona_s], return_counts=True)
        for c, cnt in sorted(zip(valores, cuentas), key=lambda x: -x[1]):
            if c == fondo or c == c_relleno:
                continue
            ps = (etiquetas == c) & zona_s
            if ps.sum() < 0.12 * fill_mask.sum():
                continue
            dx, dy = _desplazamiento_sombra(acumulado, ps, alto)
            if dx is not None and math.hypot(dx, dy) > alto * 0.03:
                sombra_d = {"color": _hex(np.median(crop[ps], 0)), "dx": dx, "dy": dy, "desenfoque": 0.0, "opacidad": 1.0}
                M_s = np.float32([[1, 0, dx], [0, 1, dy]])
                sombra_m = cv2.warpAffine(acumulado.astype(np.uint8), M_s, (Wc, Hc)) > 0
                mascara_total |= sombra_m
            break

    # degradado vertical en el relleno
    degradado = None
    ys = np.nonzero(fill_mask)[0]
    if len(ys) > 50:
        y0, y1 = np.percentile(ys, [3, 97])
        arriba = fill_mask & (np.arange(Hc)[:, None] < y0 + (y1 - y0) * 0.25)
        abajo = fill_mask & (np.arange(Hc)[:, None] > y1 - (y1 - y0) * 0.25)
        if arriba.sum() > 10 and abajo.sum() > 10:
            ca, cb = np.median(crop[arriba], 0), np.median(crop[abajo], 0)
            if _lab_dist(ca, cb) > 22:
                degradado = [_hex(ca), _hex(cb)]
    nucleo = cv2.erode(fill_mask.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    color_relleno = _hex(np.median(crop[nucleo], 0) if nucleo.sum() > 10 else rgb_relleno)

    # texto: heurística para «¡» inicial que el OCR suele omitir
    texto = linea.texto
    if texto.endswith("!") and not texto.startswith("¡") and _empieza_con_exclamacion_invertida(fill_mask, alto):
        texto = "¡" + texto
    if texto.endswith("?") and not texto.startswith("¿") and _empieza_con_interrogacion_invertida(fill_mask, alto):
        texto = "¿" + texto

    # fuente parecida y tamaño
    fuentes = comparar_fuentes(texto, fill_mask.astype(np.uint8) * 255)
    if not fuentes:
        return None
    mejor = fuentes[0]
    bb = _bbox(fill_mask)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    f100 = fuente_de(mejor["familia"], mejor["peso"], 100)
    m100, _ = renderizar_linea(texto, f100)
    b100 = _bbox(m100)
    h100 = b100[3] - b100[1]
    tam = 100.0 * th / max(1, h100)
    f_t = fuente_de(mejor["familia"], mejor["peso"], tam)
    mt, _ = renderizar_linea(texto, f_t)
    bt = _bbox(mt)
    espaciado = 0.0
    if len(texto) > 1:
        espaciado = float(np.clip((tw - (bt[2] - bt[0])) / (len(texto) - 1), -0.15 * tam, 0.6 * tam))
    tam, espaciado = _afinar_tamano(texto, mejor, fill_mask, bb, tam, espaciado)

    DEPURAR["ultimo"] = {"crop": crop, "relleno": fill_mask, "acumulado": acumulado, "total": mascara_total, "etiquetas": etiquetas}
    # caja de tinta del relleno → coordenadas de la imagen
    ang = math.degrees(math.atan2(linea.quad[1][1] - linea.quad[0][1], linea.quad[1][0] - linea.quad[0][0]))
    esquina = cv2.perspectiveTransform(np.float32([[[bb[0], bb[1]]]]), Minv)[0, 0]
    escala = float(np.linalg.norm(linea.quad[1] - linea.quad[0]) / max(1.0, ancho))

    # máscaras en coordenadas de la imagen (para el relleno inteligente y la comprobación)
    Hi, Wi = img.shape[:2]
    k = max(2, int(round(alto * 0.06)))
    mt_dil = cv2.dilate(mascara_total.astype(np.uint8) * 255, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
    mascara_img = cv2.warpPerspective(mt_dil, Minv, (Wi, Hi), flags=cv2.INTER_NEAREST) > 0
    rc = cv2.warpPerspective(acumulado.astype(np.uint8) * 255, Minv, (Wi, Hi), flags=cv2.INTER_NEAREST) > 0

    est = EstiloTexto(
        texto=texto,
        puntuacion_ocr=linea.puntuacion,
        angulo=round(ang, 2),
        relleno=color_relleno,
        degradado=degradado,
        contornos=contornos,
        sombra=sombra_d,
        fuentes=fuentes,
        familia=mejor["familia"],
        peso=mejor["peso"],
        tam_fuente=round(tam * escala, 1),
        espaciado=round(espaciado * escala, 2),
        caja_tinta={"x": float(esquina[0]), "y": float(esquina[1]), "w": float(tw * escala), "h": float(th * escala)},
        mascara=mascara_img,
        mascara_relleno_contorno=rc,
    )
    est.fidelidad = fidelidad(est, img.shape[:2])
    return est


def _afinar_tamano(texto, fuente, fill_mask, bb, tam, espaciado):
    """Busca el tamaño (y espaciado) que mejor superpone el texto renderizado sobre la tinta."""
    objetivo = fill_mask[bb[1]:bb[3], bb[0]:bb[2]]
    tw, th = objetivo.shape[1], objetivo.shape[0]
    mejor = (-1.0, tam, espaciado)
    for factor in np.arange(0.84, 1.17, 0.03):
        t = tam * factor
        f = fuente_de(fuente["familia"], fuente["peso"], t)
        m0, _ = renderizar_linea(texto, f)
        b0 = _bbox(m0)
        if b0 is None:
            continue
        esp = 0.0
        if len(texto) > 1:
            esp = float(np.clip((tw - (b0[2] - b0[0])) / (len(texto) - 1), -0.15 * t, 0.6 * t))
        m, _ = renderizar_linea(texto, f, esp)
        b = _bbox(m)
        r = m[b[1]:b[3], b[0]:b[2]] > 127
        # alinea por la esquina superior izquierda de la tinta, ajustando la altura relativa
        H, W = max(th, r.shape[0]), max(tw, r.shape[1])
        A = np.zeros((H, W), bool)
        B = np.zeros((H, W), bool)
        A[:th, :tw] = objetivo
        B[: r.shape[0], : r.shape[1]] = r
        iou = (A & B).sum() / max(1, (A | B).sum())
        if iou > mejor[0]:
            mejor = (iou, t, esp)
    return float(mejor[1]), float(mejor[2])


def _pureza_anillo(m: np.ndarray, etiquetas: np.ndarray, cercania: np.ndarray) -> float:
    D = cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, 3)
    r = (D > 1.5) & (D <= 3.5) & cercania
    if r.sum() < 10:
        return 0.0
    _, c = np.unique(etiquetas[r], return_counts=True)
    return float(c.max() / r.sum())


def _fusionar_degradado(fill: np.ndarray, etiquetas: np.ndarray, cercania: np.ndarray, otros: list[int], alto: float = 0.0) -> np.ndarray:
    """Relleno en degradado: k-means lo parte en varios colores. Une al relleno los grupos
    que hacen que el anillo exterior sea mucho más uniforme (el contorno o el fondo)."""
    pureza = _pureza_anillo(fill, etiquetas, cercania)
    for _ in range(2):
        mejor, p_mejor = None, pureza
        for c in otros:
            prueba = fill | ((etiquetas == c) & cercania & (cv2.dilate(fill.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0))
            if prueba.sum() <= fill.sum() * 1.05:
                continue
            # crece por conectividad: solo los píxeles de c conectados con el relleno
            n, lab = cv2.connectedComponents((fill | ((etiquetas == c) & cercania)).astype(np.uint8), connectivity=8)
            ids = np.unique(lab[fill])
            prueba = np.isin(lab, ids[ids > 0])
            p = _pureza_anillo(prueba, etiquetas, cercania)
            if p > p_mejor + 0.15 and alto and _desplazamiento_sombra(fill, (etiquetas == c) & cercania & ~fill, alto)[0] is not None:
                continue  # es una sombra (copia desplazada), no parte del degradado
            if p > p_mejor + 0.15 and p > 0.6 and prueba.sum() < fill.sum() * 3:
                mejor, p_mejor = (c, prueba), p
        if mejor is None:
            break
        fill, pureza = mejor[1], p_mejor
        otros = [c for c in otros if c != mejor[0]]
    return fill


def _filtrar_por_contorno(fill: np.ndarray, etiquetas: np.ndarray, cercania: np.ndarray, alto: float) -> np.ndarray:
    """Si la mayoría del relleno está rodeado por un mismo color (contorno), descarta los
    componentes que no lo están (suelen ser trozos del fondo con el mismo color)."""
    D = cv2.distanceTransform((~fill).astype(np.uint8), cv2.DIST_L2, 3)
    anillo = (D > 1.5) & (D <= 3.5) & cercania
    if anillo.sum() < 10:
        return fill
    n, lab, st, _ = cv2.connectedComponentsWithStats(fill.astype(np.uint8), 8)
    if n <= 2:
        return fill
    # color dominante del anillo, ponderado por el área de cada componente
    lab_cerca = cv2.dilate(lab.astype(np.float32), np.ones((9, 9), np.uint8)).astype(np.int32)
    valores, cuentas = np.unique(etiquetas[anillo], return_counts=True)
    c = int(valores[np.argmax(cuentas)])
    if cuentas.max() / anillo.sum() < 0.35:
        return fill
    out = np.zeros_like(fill)
    alturas = st[1:, cv2.CC_STAT_HEIGHT]
    h_med = float(np.median(alturas[alturas > alto * 0.3])) if (alturas > alto * 0.3).any() else alto
    for i in range(1, n):
        ri = anillo & (lab_cerca == i)
        if ri.sum() == 0:
            continue
        frac = (etiquetas[ri] == c).mean()
        h = st[i, cv2.CC_STAT_HEIGHT]
        if frac >= 0.5 or (frac >= 0.3 and h > h_med * 0.6):
            out |= lab == i
    return out if out.sum() > 0.3 * fill.sum() else fill


def _empieza_con_exclamacion_invertida(fill: np.ndarray, alto: float) -> bool:
    n, lab, st, _ = cv2.connectedComponentsWithStats(fill.astype(np.uint8), 8)
    if n < 3:
        return False
    comps = sorted(range(1, n), key=lambda i: st[i, cv2.CC_STAT_LEFT])
    a, b = comps[0], comps[1]
    xa, ya, wa, ha, _ = st[a]
    xb, yb, wb, hb, _ = st[b]
    solapan = min(xa + wa, xb + wb) - max(xa, xb) > 0.5 * min(wa, wb)
    if not solapan:
        return False
    sup, inf = (st[a], st[b]) if ya < yb else (st[b], st[a])
    # altura de referencia: la de los glifos (la caja OCR puede ser más alta)
    h_glifo = float(np.max(st[1:, cv2.CC_STAT_HEIGHT]))
    alto = min(alto, h_glifo * 1.05)
    return sup[3] < inf[3] * 0.6 and max(wa, wb) < alto * 0.5 and inf[3] > alto * 0.4 and sup[1] < inf[1]


def _empieza_con_interrogacion_invertida(fill: np.ndarray, alto: float) -> bool:
    n, lab, st, _ = cv2.connectedComponentsWithStats(fill.astype(np.uint8), 8)
    if n < 3:
        return False
    comps = sorted(range(1, n), key=lambda i: st[i, cv2.CC_STAT_LEFT])
    a, b = st[comps[0]], st[comps[1]]
    solapan = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]) > 0.3 * min(a[2], b[2])
    if not solapan:
        return False
    sup, inf = (a, b) if a[1] < b[1] else (b, a)
    # ¿ : punto pequeño arriba y gancho más ancho abajo
    return sup[3] < inf[3] * 0.5 and inf[2] > sup[2] * 1.4


def _desplazamiento_sombra(cuerpo: np.ndarray, sombra: np.ndarray, alto: float):
    esc = 48.0 / max(alto, 1)
    if esc < 1:
        tam = (max(4, int(cuerpo.shape[1] * esc)), max(4, int(cuerpo.shape[0] * esc)))
        c = cv2.resize(cuerpo.astype(np.uint8), tam, interpolation=cv2.INTER_AREA).astype(np.float32)
        s = cv2.resize(sombra.astype(np.uint8), tam, interpolation=cv2.INTER_AREA).astype(np.float32)
    else:
        esc = 1.0
        c, s = cuerpo.astype(np.float32), sombra.astype(np.float32)
    c = (c > 0.5).astype(np.float32)
    s = (s > 0.5).astype(np.float32)
    r = int(max(2, 0.35 * alto * esc))
    mejor, best = None, -1.0
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if abs(dx) + abs(dy) < 2:
                continue
            M = np.float32([[1, 0, dx], [0, 1, dy]])
            sh = cv2.warpAffine(c, M, (c.shape[1], c.shape[0]))
            fuera = sh * (1 - c)  # parte del cuerpo desplazado que asoma por detrás
            n = fuera.sum()
            if n < 0.05 * c.sum():
                continue
            # debe caer sobre la sombra y la sombra debe quedar explicada por el desplazamiento
            val = float((fuera * s).sum() / n) * float((fuera * s).sum() / (s.sum() + 1e-6)) ** 0.5
            if val > best:
                best, mejor = val, (dx, dy)
    if mejor is None or best < 0.35:
        return None, None
    return round(mejor[0] / esc, 1), round(mejor[1] / esc, 1)


# ------------------------------------------------------------------ renderizado y fidelidad

def renderizar_estilo(est: EstiloTexto, tam_img: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Renderiza la capa de texto (relleno + contornos + sombra) como RGBA del tamaño de la
    imagen, siguiendo la misma geometría que el editor. Devuelve (rgba, mascara_relleno_contorno)."""
    Hi, Wi = tam_img
    f = fuente_de(est.familia, est.peso, est.tam_fuente)
    trazo_total = int(round(sum(c["ancho"] for c in est.contornos)))
    capa_mask, (ox, oy) = renderizar_linea(est.texto, f, est.espaciado)
    bb = _bbox(capa_mask)
    if bb is None:
        return np.zeros((Hi, Wi, 4), np.uint8), np.zeros((Hi, Wi), bool)
    pad = trazo_total + int(abs(est.sombra["dx"]) + abs(est.sombra["dy"]) if est.sombra else 0) + 4
    h0, w0 = capa_mask.shape
    lienzo = np.zeros((h0 + 2 * pad, w0 + 2 * pad, 4), np.float32)

    def pegar(mask, color, alpha=1.0, dx=0, dy=0):
        rgb = np.array([int(color[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
        a = np.zeros(lienzo.shape[:2], np.float32)
        y, x = pad + int(round(dy)), pad + int(round(dx))
        a[y:y + mask.shape[0], x:x + mask.shape[1]] = mask.astype(np.float32) / 255 * alpha
        lienzo[..., :3] = lienzo[..., :3] * (1 - a[..., None]) + rgb * a[..., None]
        lienzo[..., 3] = lienzo[..., 3] * (1 - a) + a

    # de fuera hacia dentro: sombra, contornos (el más externo primero), relleno
    anchos = np.cumsum([c["ancho"] for c in est.contornos]) if est.contornos else []
    if est.sombra:
        m_s, _ = renderizar_linea(est.texto, f, est.espaciado, trazo=int(round(anchos[-1])) if len(anchos) else 0)
        m_s = _alinear(m_s, capa_mask)
        pegar(m_s, est.sombra["color"], est.sombra.get("opacidad", 1.0), est.sombra["dx"], est.sombra["dy"])
    for c, a_acum in reversed(list(zip(est.contornos, anchos))):
        m_c, _ = renderizar_linea(est.texto, f, est.espaciado, trazo=int(round(a_acum)))
        pegar(_alinear(m_c, capa_mask), c["color"])
    if est.degradado:
        pegar_degradado = capa_mask.astype(np.float32) / 255
        ys = np.nonzero(capa_mask > 127)[0]
        y0, y1 = (ys.min(), ys.max()) if len(ys) else (0, 1)
        t = np.clip((np.arange(h0)[:, None] - y0) / max(1, y1 - y0), 0, 1)
        c0 = np.array([int(est.degradado[0][i:i + 2], 16) for i in (1, 3, 5)], np.float32)
        c1 = np.array([int(est.degradado[1][i:i + 2], 16) for i in (1, 3, 5)], np.float32)
        col = c0 * (1 - t[..., None]) + c1 * t[..., None]
        a = np.zeros(lienzo.shape[:2], np.float32)
        a[pad:pad + h0, pad:pad + w0] = pegar_degradado
        colfull = np.zeros(lienzo.shape[:2] + (3,), np.float32)
        colfull[pad:pad + h0, pad:pad + w0] = np.broadcast_to(col, (h0, w0, 3))
        lienzo[..., :3] = lienzo[..., :3] * (1 - a[..., None]) + colfull * a[..., None]
        lienzo[..., 3] = lienzo[..., 3] * (1 - a) + a
    else:
        pegar(capa_mask, est.relleno)

    # colocación: la esquina sup-izq de la tinta del relleno va a caja_tinta (x, y), girada
    ang = math.radians(est.angulo)
    tinta_x, tinta_y = pad + bb[0], pad + bb[1]
    cos, sin = math.cos(ang), math.sin(ang)
    tx = est.caja_tinta["x"] - (cos * tinta_x - sin * tinta_y)
    ty = est.caja_tinta["y"] - (sin * tinta_x + cos * tinta_y)
    M = np.float32([[cos, -sin, tx], [sin, cos, ty]])
    rgba = cv2.warpAffine(lienzo, M, (Wi, Hi), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    alfa_rc = np.zeros(lienzo.shape[:2], np.float32)
    trazo_m, _ = renderizar_linea(est.texto, f, est.espaciado, trazo=int(round(anchos[-1])) if len(anchos) else 0)
    trazo_m = _alinear(trazo_m, capa_mask)
    alfa_rc[pad:pad + trazo_m.shape[0], pad:pad + trazo_m.shape[1]] = trazo_m[: lienzo.shape[0] - pad, : lienzo.shape[1] - pad] / 255
    rc = cv2.warpAffine(alfa_rc, M, (Wi, Hi), flags=cv2.INTER_LINEAR) > 0.5
    out = np.empty(rgba.shape, np.uint8)
    out[..., :3] = rgba[..., :3].clip(0, 255).round()
    out[..., 3] = (rgba[..., 3].clip(0, 1) * 255).round()
    return out, rc


def _alinear(m: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Recorta/rellena `m` al tamaño de `ref` (ambos con el mismo origen de dibujo)."""
    out = np.zeros_like(ref)
    h, w = min(m.shape[0], ref.shape[0]), min(m.shape[1], ref.shape[1])
    out[:h, :w] = m[:h, :w]
    return out


def fidelidad(est: EstiloTexto, tam_img: tuple[int, int]) -> float:
    """IoU entre la tinta detectada (relleno+contornos) y la renderizada con la fuente elegida."""
    try:
        _, rc = renderizar_estilo(est, tam_img)
    except Exception:  # pragma: no cover
        log.exception("No se pudo renderizar el texto para comprobarlo")
        return 0.0
    a = est.mascara_relleno_contorno
    inter = (a & rc).sum()
    union = (a | rc).sum()
    return round(float(inter / union) if union else 0.0, 3)


def analizar_textos(img: np.ndarray, progreso=None) -> list[EstiloTexto]:
    lineas = leer_texto(img)
    out = []
    for i, l in enumerate(lineas):
        if progreso:
            progreso(f"Analizando texto {i + 1}/{len(lineas)}: «{l.texto}»")
        alto = np.linalg.norm(l.quad[3] - l.quad[0])
        if alto < 9:
            continue
        try:
            e = analizar_linea(img, l)
        except Exception:
            log.exception("Error analizando «%s»", l.texto)
            e = None
        if e is not None:
            out.append(e)
    return out
