"""Pruebas del motor. Ejecutar:  .venv/bin/python -m pytest tests -q
Las que necesitan modelos se saltan si no están descargados."""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
os.environ.setdefault("ESTUDIO_PROYECTOS", tempfile.mkdtemp(prefix="estudio-pruebas-"))
os.environ["NUBE_ACTIVADA"] = "false"

from engine import inpaint, layers  # noqa: E402
from engine import text as tx  # noqa: E402
from engine.models import registry  # noqa: E402

FUENTES = RAIZ / "assets" / "fonts"
hay = registry.disponible


def png(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def data_url(arr: np.ndarray) -> str:
    return "data:image/png;base64," + base64.b64encode(png(Image.fromarray(arr))).decode()


# ------------------------------------------------------------------ carga y validación

def test_imagen_danada_da_error_claro():
    with pytest.raises(layers.ImagenInvalida, match="dañado"):
        layers.cargar_imagen(b"esto no es una imagen")


def test_imagen_vacia_y_pequena():
    with pytest.raises(layers.ImagenInvalida):
        layers.cargar_imagen(b"")
    with pytest.raises(layers.ImagenInvalida, match="pequeña"):
        layers.cargar_imagen(png(Image.new("RGB", (10, 10))))


def test_formato_no_admitido():
    b = io.BytesIO()
    Image.new("RGB", (64, 64)).save(b, "BMP")
    with pytest.raises(layers.ImagenInvalida, match="Formato"):
        layers.cargar_imagen(b.getvalue())


def test_png_transparente_y_reduccion():
    im = Image.new("RGBA", (3000, 1500), (255, 0, 0, 0))
    arr, avisos = layers.cargar_imagen(png(im))
    assert arr.shape == (1024, 2048, 3)
    assert avisos and "reducido" in avisos[0]


# ------------------------------------------------------------------ registro y licencias

def test_registro_de_modelos_completo():
    for m in registry.MODELOS.values():
        assert m.licencia and m.fuente.startswith("https://")
        assert m.uso_comercial, f"{m.clave} no permite uso comercial"
        assert m.repo and m.revision or m.url
        assert m.archivos


def test_manifiesto_de_fuentes_y_licencias():
    manifest = json.loads((FUENTES / "manifest.json").read_text("utf-8"))
    assert len(manifest) >= 40
    for f in manifest:
        assert f["licencia"] in {"OFL", "APACHE2"}
        assert (FUENTES / f["archivo_licencia"]).exists()
    licencias = (RAIZ / "assets" / "LICENSES.md").read_text("utf-8")
    for f in manifest:
        assert f["familia"] in licencias, f"{f['familia']} no está documentada en LICENSES.md"


# ------------------------------------------------------------------ fuentes y estilo de texto

def render_texto(texto, carpeta, archivo, tam, relleno, contorno=None, ancho=0, fondo=(30, 60, 120)):
    im = Image.new("RGB", (900, 260), fondo)
    f = ImageFont.truetype(str(FUENTES / carpeta / archivo), tam)
    ImageDraw.Draw(im).text((40, 50), texto, font=f, fill=relleno, stroke_width=ancho, stroke_fill=contorno)
    return np.asarray(im)


def test_identifica_la_fuente_en_el_top3():
    img = render_texto("GRAN FINAL", "anton", "Anton-Regular.ttf", 120, "#ffffff")
    m = (img.astype(int).sum(-1) > 600).astype(np.uint8) * 255
    top = tx.comparar_fuentes("GRAN FINAL", m)
    assert len(top) == 3
    assert "Anton" in [t["familia"] for t in top]


@pytest.mark.skipif(not (hay("ocr_det") and hay("ocr_rec")), reason="faltan los modelos de OCR")
def test_ocr_y_estilo_con_contorno():
    img = render_texto("¡VAMOS!", "bangers", "Bangers-Regular.ttf", 130, "#ffe600", "#000000", 9)
    estilos = tx.analizar_textos(img)
    assert estilos, "no se detectó texto"
    e = estilos[0]
    assert e.texto.replace("¡", "").startswith("VAMOS")
    assert e.relleno.lower() in {"#ffe600", "#ffe700", "#fee600", "#ffe500"} or tx._lab_dist([255, 230, 0], [int(e.relleno[i:i + 2], 16) for i in (1, 3, 5)]) < 10
    assert len(e.contornos) == 1 and 6 <= e.contornos[0]["ancho"] <= 12
    assert "Bangers" in [f["familia"] for f in e.fuentes]
    assert e.fidelidad > 0.6


# ------------------------------------------------------------------ relleno inteligente

@pytest.mark.skipif(not hay("lama"), reason="falta LaMa")
def test_relleno_reconstruye_un_degradado():
    x = np.linspace(0, 255, 320, dtype=np.float32)
    img = np.dstack([np.tile(x, (240, 1)), np.full((240, 320), 80, np.float32), np.tile(x[::-1], (240, 1))]).astype(np.uint8)
    sucia = img.copy()
    sucia[90:150, 120:200] = 255
    mascara = np.zeros((240, 320), bool)
    mascara[85:155, 115:205] = True
    out = inpaint.rellenar(sucia, mascara)
    err = np.abs(out[90:150, 120:200].astype(int) - img[90:150, 120:200].astype(int)).mean()
    assert err < 20, f"error medio {err:.1f}"


# ------------------------------------------------------------------ API

@pytest.fixture(scope="module")
def cliente():
    from fastapi.testclient import TestClient

    from engine.server import app

    with TestClient(app) as c:
        yield c


def test_estado(cliente):
    r = cliente.get("/api/estado").json()
    assert r["dispositivo"]["dispositivo"] in {"cpu", "cuda", "mps"}
    assert r["nube"]["activada"] is False


def test_proyectos_y_recursos(cliente):
    p = cliente.post("/api/proyectos", json={"name": "Prueba", "width": 640, "height": 360, "layers": []}).json()
    pid = p["id"]
    assert cliente.get(f"/api/proyectos/{pid}").json()["name"] == "Prueba"
    r = cliente.post(f"/api/proyectos/{pid}/recursos", files={"archivo": ("a.png", png(Image.new("RGB", (64, 64), "red")), "image/png")}).json()
    assert r["width"] == 64 and r["url"].startswith(f"/api/proyectos/{pid}/recursos/")
    assert cliente.get(r["url"]).status_code == 200
    # guardar y listar
    assert cliente.put(f"/api/proyectos/{pid}", json={"name": "Renombrado", "width": 640, "height": 360, "layers": []}).status_code == 200
    assert any(x["id"] == pid and x["name"] == "Renombrado" for x in cliente.get("/api/proyectos").json())
    # recurso dañado
    assert cliente.post(f"/api/proyectos/{pid}/recursos", files={"archivo": ("a.png", b"basura", "image/png")}).status_code == 422
    assert cliente.delete(f"/api/proyectos/{pid}").status_code == 200


def test_rutas_maliciosas_rechazadas(cliente):
    assert cliente.get("/api/proyectos/../../etc").status_code == 404
    assert cliente.get("/api/proyectos/abcdef0123/recursos/..%2F..%2Fsecret").status_code in {400, 404}


def test_descomponer_imagen_danada(cliente):
    r = cliente.post("/api/descomponer", files={"archivo": ("x.jpg", b"no es imagen", "image/jpeg")})
    assert r.status_code == 422
    assert "dañado" in r.json()["detalle"]


def test_nube_desactivada_por_defecto(cliente):
    info = cliente.get("/api/nube?width=1280&height=720").json()
    assert info["activada"] is False and info["coste"]["usd_por_imagen"] > 0
    p = cliente.post("/api/proyectos", json={"name": "N", "width": 64, "height": 64, "layers": []}).json()
    r = cliente.post(f"/api/proyectos/{p['id']}/recursos", files={"archivo": ("a.png", png(Image.new("RGB", (64, 64))), "image/png")}).json()
    r2 = cliente.post("/api/nube/relleno-generativo", json={"proyecto": p["id"], "recurso": r["url"], "prompt": "un cielo azul", "confirmado": True})
    assert r2.status_code == 403


def test_optimizar_png_respeta_el_peso(cliente):
    ruido = (np.random.default_rng(0).random((400, 400, 3)) * 255).astype(np.uint8)
    datos = png(Image.fromarray(ruido))
    limite = len(datos) // 2
    r = cliente.post("/api/ia/optimizar-png", files={"archivo": ("a.png", datos, "image/png")}, data={"max_bytes": str(limite)})
    assert r.status_code == 200 and len(r.content) <= limite


@pytest.mark.skipif(not hay("lama"), reason="falta LaMa")
def test_borrar_con_ia(cliente):
    p = cliente.post("/api/proyectos", json={"name": "B", "width": 256, "height": 256, "layers": []}).json()
    im = Image.new("RGB", (256, 256), (40, 120, 200))
    ImageDraw.Draw(im).ellipse((100, 100, 150, 150), fill="yellow")
    r = cliente.post(f"/api/proyectos/{p['id']}/recursos", files={"archivo": ("a.png", png(im), "image/png")}).json()
    m = np.zeros((256, 256, 4), np.uint8)
    m[95:155, 95:155] = 255
    out = cliente.post("/api/ia/borrar", json={"proyecto": p["id"], "recurso": r["url"], "mascara": data_url(m)}).json()
    res = np.asarray(Image.open(io.BytesIO(cliente.get(out["url"]).content)).convert("RGB"))
    assert np.abs(res[125, 125].astype(int) - [40, 120, 200]).max() < 30


@pytest.mark.skipif(not hay("sam2"), reason="falta SAM 2.1")
def test_segmentar_con_un_clic(cliente):
    p = cliente.post("/api/proyectos", json={"name": "S", "width": 320, "height": 240, "layers": []}).json()
    im = Image.new("RGB", (320, 240), (20, 20, 20))
    ImageDraw.Draw(im).rectangle((100, 60, 220, 180), fill=(230, 60, 40))
    r = cliente.post(f"/api/proyectos/{p['id']}/recursos", files={"archivo": ("a.png", png(im), "image/png")}).json()
    s = cliente.post("/api/ia/segmentar", json={"proyecto": p["id"], "recurso": r["url"], "puntos": [{"x": 160, "y": 120, "positivo": True}]}).json()
    c = s["capa"]
    assert abs(c["x"] - 100) < 8 and abs(c["width"] - 121) < 16


# ------------------------------------------------------------------ descomposición completa

@pytest.mark.skipif(not all(hay(k) for k in ("sam2", "rtdetr", "lama", "ocr_det", "ocr_rec")), reason="faltan modelos")
def test_descomposicion_completa_se_parece_al_original(tmp_path):
    datos = (RAIZ / "test-images" / "07_mascota.png").read_bytes()
    img, _ = layers.cargar_imagen(datos)
    res = layers.descomponer(img, layers.Almacen(tmp_path, "/x"))
    roles = [c["role"] for c in res.proyecto["layers"]]
    assert "fondo" in roles and "original" in roles
    textos = [c["text"] for c in res.proyecto["layers"] if c["type"] == "text"]
    assert any("GANA" in t for t in textos)
    assert any(r in roles for r in ("sujeto", "objeto"))
    assert res.metricas["ssim"] > 0.9
