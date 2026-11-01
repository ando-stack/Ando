#!/usr/bin/env python3
"""Herramientas del miniaturero. Todo en local y en CPU (usa GPU si onnxruntime-gpu está instalado).

Uso:
  python3 herramientas/mini.py recortar   FOTO SALIDA.png [--borde 0]          # quita el fondo (BiRefNet)
  python3 herramientas/mini.py mascara    FOTO SALIDA.png [--crecer 25]        # máscara de la persona (para borrarla)
  python3 herramientas/mini.py borrar     FOTO MASCARA.png SALIDA.png          # relleno inteligente (LaMa)
  python3 herramientas/mini.py borrar     FOTO --caja x,y,w,h [--caja ...] SALIDA.png
  python3 herramientas/mini.py caras      FOTO                                 # lista caras y avisa si son pequeñas
  python3 herramientas/mini.py cambiar-cara MI_CARA DESTINO SALIDA [--indice 0] [--sin-mejora]
  python3 herramientas/mini.py igualar-luz RECORTE.png REFERENCIA SALIDA.png [--fuerza 0.6]
  python3 herramientas/mini.py revisar    MINIATURA.png [MAS.png ...] --salida comparativa.png
  python3 herramientas/mini.py exportar   MINIATURA.png                        # crea la versión JPG <= 2 MB

Nunca escribe sobre la imagen de entrada.
"""
import argparse, os, sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

BASE = Path(__file__).resolve().parent.parent
MOD = BASE / "modelos"
_sesiones = {}


def sesion(nombre):
    import onnxruntime as ort
    if nombre not in _sesiones:
        ruta = MOD / nombre
        if not ruta.exists():
            sys.exit(f"Falta el modelo {ruta}. Ejecuta ./instalar.sh")
        prov = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
        so = ort.SessionOptions(); so.log_severity_level = 3
        _sesiones[nombre] = ort.InferenceSession(str(ruta), so, providers=prov)
    return _sesiones[nombre]


def abrir(ruta):
    """Abre una imagen respetando la orientación EXIF. Devuelve RGB uint8."""
    im = ImageOps.exif_transpose(Image.open(ruta))
    return np.array(im.convert("RGB"))


def no_pisar(entrada, salida):
    if Path(entrada).resolve() == Path(salida).resolve():
        sys.exit("La salida no puede ser el mismo archivo que la entrada.")
    if "entrada" in Path(salida).resolve().parts and BASE in Path(salida).resolve().parents:
        sys.exit("No se escribe nada dentro de /entrada: guarda en /salida.")
    Path(salida).parent.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------- recorte (BiRefNet)
def alfa_persona(rgb):
    h, w = rgb.shape[:2]
    x = cv2.resize(rgb, (1024, 1024), interpolation=cv2.INTER_AREA if max(h, w) > 1024 else cv2.INTER_CUBIC)
    x = (x.astype(np.float32) / 255 - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    s = sesion("birefnet.onnx")
    y = s.run(None, {s.get_inputs()[0].name: x})[0][0, 0]
    y = 1 / (1 + np.exp(-y))
    return cv2.resize(y, (w, h), interpolation=cv2.INTER_CUBIC).clip(0, 1)


def descontaminar(rgb, a):
    """Quita el halo del fondo antiguo en los bordes (estimación rápida del primer plano)."""
    seguro = (a > 0.95).astype(np.uint8)
    if seguro.sum() == 0:
        return rgb
    rgbf = rgb.astype(np.float32)
    borde = ((a > 0.02) & (a <= 0.95))
    # color del interior propagado hacia el borde
    interior = cv2.inpaint(rgb, (1 - seguro) * 255, 5, cv2.INPAINT_TELEA).astype(np.float32)
    k = a[..., None]
    mezcla = np.where(borde[..., None], interior * (1 - k) + rgbf * k, rgbf)
    return mezcla.clip(0, 255).astype(np.uint8)


def cmd_recortar(a):
    no_pisar(a.foto, a.salida)
    rgb = abrir(a.foto)
    al = alfa_persona(rgb)
    al[al < 0.03] = 0
    rgb2 = descontaminar(rgb, al)
    rgba = np.dstack([rgb2, (al * 255).astype(np.uint8)])
    ys, xs = np.where(al > 0.05)
    if len(xs) == 0:
        sys.exit("No he encontrado ningún sujeto en la foto.")
    b = a.borde
    y0, y1 = max(ys.min() - b, 0), min(ys.max() + b + 1, rgb.shape[0])
    x0, x1 = max(xs.min() - b, 0), min(xs.max() + b + 1, rgb.shape[1])
    Image.fromarray(rgba[y0:y1, x0:x1]).save(a.salida)
    print(f"Recorte guardado en {a.salida} ({x1-x0}x{y1-y0}px; caja en la foto original: {x0},{y0},{x1-x0},{y1-y0})")


def cmd_mascara(a):
    no_pisar(a.foto, a.salida)
    al = alfa_persona(abrir(a.foto))
    m = (al > 0.1).astype(np.uint8) * 255
    if a.crecer:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * a.crecer + 1,) * 2)
        m = cv2.dilate(m, k)
    Image.fromarray(m).save(a.salida)
    print(f"Máscara guardada en {a.salida}")


# ---------------------------------------------------------------- relleno (LaMa)
def lama_512(rgb, m):
    x = (cv2.resize(rgb, (512, 512), interpolation=cv2.INTER_AREA).astype(np.float32) / 255).transpose(2, 0, 1)[None]
    mm = (cv2.resize(m, (512, 512), interpolation=cv2.INTER_NEAREST) > 127).astype(np.float32)[None, None]
    s = sesion("lama_fp32.onnx")
    y = s.run(None, {"image": x, "mask": mm})[0][0].transpose(1, 2, 0)
    if y.max() <= 1.5:
        y = y * 255
    return y.clip(0, 255).astype(np.uint8)


def rellenar(rgb, m):
    """Rellena la zona blanca de la máscara. Trabaja por recortes para no perder resolución."""
    h, w = m.shape
    sal = rgb.copy()
    n, etiquetas, stats, _ = cv2.connectedComponentsWithStats((m > 127).astype(np.uint8))
    for i in range(1, n):
        x, y, bw, bh, _ = stats[i]
        lado = int(max(bw, bh) * 1.8) + 64
        lado = min(max(lado, 256), max(h, w))
        cx, cy = x + bw // 2, y + bh // 2
        x0 = int(np.clip(cx - lado // 2, 0, max(w - lado, 0))); y0 = int(np.clip(cy - lado // 2, 0, max(h - lado, 0)))
        x1, y1 = min(x0 + lado, w), min(y0 + lado, h)
        trozo, mtrozo = sal[y0:y1, x0:x1], ((etiquetas[y0:y1, x0:x1] == i) * 255).astype(np.uint8)
        res = cv2.resize(lama_512(trozo, mtrozo), (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
        k = cv2.GaussianBlur(cv2.dilate(mtrozo, np.ones((9, 9), np.uint8)), (0, 0), 3).astype(np.float32)[..., None] / 255
        sal[y0:y1, x0:x1] = (res * k + trozo * (1 - k)).astype(np.uint8)
    return sal


def cmd_borrar(a):
    rgb = abrir(a.foto)
    if a.caja:
        m = np.zeros(rgb.shape[:2], np.uint8)
        for c in a.caja:
            x, y, w, h = [int(v) for v in c.split(",")]
            m[y:y + h, x:x + w] = 255
    else:
        if not a.mascara:
            sys.exit("Indica una máscara o --caja x,y,w,h")
        m = np.array(Image.open(a.mascara).convert("L").resize(rgb.shape[1::-1]))
    m = cv2.dilate(m, np.ones((7, 7), np.uint8))
    no_pisar(a.foto, a.salida)
    Image.fromarray(rellenar(rgb, m)).save(a.salida)
    print(f"Relleno guardado en {a.salida}")


# ---------------------------------------------------------------- caras
ARCFACE = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]], np.float32)
FFHQ = np.array([[0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904],
                 [0.39308822, 0.72541100], [0.61150205, 0.72490465]], np.float32)


def detectar(rgb, umbral=0.7):
    h, w = rgb.shape[:2]
    escala = min(1.0, 1600 / max(h, w))
    peq = cv2.resize(rgb, None, fx=escala, fy=escala) if escala < 1 else rgb
    det = cv2.FaceDetectorYN.create(str(MOD / "yunet.onnx"), "", (peq.shape[1], peq.shape[0]), umbral, 0.3, 5000)
    _, caras = det.detect(cv2.cvtColor(peq, cv2.COLOR_RGB2BGR))
    res = []
    for c in ([] if caras is None else caras):
        c = c / np.array([escala] * 14 + [1])
        pts = c[4:14].reshape(5, 2).astype(np.float32)
        # orden de ArcFace: ojo izq. de la imagen, ojo der., nariz, boca izq., boca der.
        if pts[0, 0] > pts[1, 0]:
            pts[[0, 1]] = pts[[1, 0]]
        if pts[3, 0] > pts[4, 0]:
            pts[[3, 4]] = pts[[4, 3]]
        res.append({"caja": c[:4].astype(int).tolist(), "puntos": pts, "conf": float(c[14])})
    return sorted(res, key=lambda r: -r["caja"][2] * r["caja"][3])


def alinear(rgb, pts, tam, plantilla):
    M, _ = cv2.estimateAffinePartial2D(pts, plantilla, method=cv2.LMEDS)
    return cv2.warpAffine(rgb, M, (tam, tam), borderMode=cv2.BORDER_REPLICATE), M


def cmd_caras(a):
    rgb = abrir(a.foto)
    caras = detectar(rgb)
    if not caras:
        print("No he encontrado caras."); return
    for i, c in enumerate(caras):
        x, y, w, h = c["caja"]
        aviso = "  ⚠ cara pequeña: el cambio de cara quedará borroso" if min(w, h) < 120 else ""
        print(f"[{i}] caja={x},{y},{w},{h} confianza={c['conf']:.2f}{aviso}")


def huella(rgb, cara):
    img, _ = alinear(rgb, cara["puntos"], 112, ARCFACE)
    x = ((img.astype(np.float32) - 127.5) / 127.5).transpose(2, 0, 1)[None]
    e = sesion("arcface_w600k_r50.onnx").run(None, {"input": x})[0][0]
    return e / np.linalg.norm(e)


def emap():
    import onnx
    from onnx import numpy_helper
    if "emap" not in _sesiones:
        _sesiones["emap"] = numpy_helper.to_array(onnx.load(str(MOD / "inswapper_128.onnx")).graph.initializer[-1])
    return _sesiones["emap"]


def pegar(fondo, cara, M, tam, recorte=0.1, suav=None):
    h, w = fondo.shape[:2]
    Mi = cv2.invertAffineTransform(M)
    m = np.zeros((tam, tam), np.float32)
    b = int(tam * recorte); m[b:tam - b, b:tam - b] = 1
    m = cv2.GaussianBlur(m, (0, 0), suav or tam * 0.06)
    cara_g = cv2.warpAffine(cara, Mi, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    m_g = cv2.warpAffine(m, Mi, (w, h))[..., None]
    return (cara_g * m_g + fondo * (1 - m_g)).clip(0, 255).astype(np.uint8)


def gfpgan(rgb, cara, fuerza=0.8):
    img, M = alinear(rgb, cara["puntos"], 512, FFHQ * 512)
    x = ((img.astype(np.float32) / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None]
    y = sesion("gfpgan_1.4.onnx").run(None, {"input": x})[0][0].transpose(1, 2, 0)
    y = ((y.clip(-1, 1) + 1) / 2 * 255)
    y = y * fuerza + img * (1 - fuerza)
    return pegar(rgb, y, M, 512, recorte=0.12)


def cmd_cambiar_cara(a):
    no_pisar(a.destino, a.salida)
    fuente, destino = abrir(a.mi_cara), abrir(a.destino)
    cf, cd = detectar(fuente), detectar(destino)
    if not cf:
        sys.exit("No encuentro tu cara en la foto de origen.")
    if len(cd) <= a.indice:
        sys.exit(f"En la imagen destino hay {len(cd)} caras; usa --indice entre 0 y {len(cd)-1}.")
    if min(cf[0]["caja"][2:]) < 120:
        print("⚠ Tu cara sale pequeña en la foto de origen: el parecido será peor. Mejor una foto más cerca.")
    cara = cd[a.indice]
    lat = huella(fuente, cf[0]).reshape(1, -1) @ emap()
    lat = (lat / np.linalg.norm(lat)).astype(np.float32)
    obj, M = alinear(destino, cara["puntos"], 128, ARCFACE + [8.0, 0.0])
    x = (obj.astype(np.float32) / 255).transpose(2, 0, 1)[None]
    y = sesion("inswapper_128.onnx").run(None, {"target": x, "source": lat})[0][0].transpose(1, 2, 0)
    y = (y.clip(0, 1) * 255)
    # igualar el tono de piel a la cara original (media y desviación en LAB)
    y = transferir_color(y.astype(np.uint8), obj, fuerza=0.5).astype(np.float32)
    res = pegar(destino, y, M, 128, recorte=0.12)
    if not a.sin_mejora:
        res = gfpgan(res, cara, fuerza=0.7)
    Image.fromarray(res).save(a.salida)
    print(f"Cara cambiada en {a.salida}. Revísala de cerca: bordes, ojos y dientes.")


# ---------------------------------------------------------------- color
def transferir_color(src, ref, fuerza=0.6, mascara=None):
    s = cv2.cvtColor(src, cv2.COLOR_RGB2LAB).astype(np.float32)
    r = cv2.cvtColor(ref, cv2.COLOR_RGB2LAB).astype(np.float32)
    sel = s.reshape(-1, 3) if mascara is None else s[mascara > 0.5]
    ms, ds = sel.mean(0), sel.std(0) + 1e-3
    mr, dr = r.reshape(-1, 3).mean(0), r.reshape(-1, 3).std(0) + 1e-3
    t = (s - ms) * (1 + (dr / ds - 1) * fuerza * 0.5) + ms + (mr - ms) * fuerza
    t[..., 0] = s[..., 0] * (1 - fuerza * 0.5) + t[..., 0] * fuerza * 0.5  # la luz se toca menos
    return cv2.cvtColor(t.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def cmd_igualar_luz(a):
    no_pisar(a.recorte, a.salida)
    im = np.array(Image.open(a.recorte).convert("RGBA"))
    ref = abrir(a.referencia)
    rgb = transferir_color(im[..., :3], ref, a.fuerza, mascara=im[..., 3] / 255)
    Image.fromarray(np.dstack([rgb, im[..., 3]])).save(a.salida)
    print(f"Luz/color igualados en {a.salida}")


# ---------------------------------------------------------------- revisión y exportación
def fuente(tam):
    f = BASE / "assets/fonts/Montserrat-Variable.ttf"
    try:
        ft = ImageFont.truetype(str(f), tam); ft.set_variation_by_axes([800]); return ft
    except Exception:
        return ImageFont.load_default()


def cmd_revisar(a):
    filas = []
    for ruta in a.imagenes:
        im = Image.open(ruta).convert("RGB")
        w, h = im.size
        peso = os.path.getsize(ruta) / 1e6
        notas = [f"{Path(ruta).name}: {w}x{h}px, {peso:.2f} MB"]
        if abs(w / h - 16 / 9) > 0.01: notas.append("⚠ no es 16:9")
        if w < 1280: notas.append("⚠ ancho < 1280 (mínimo YouTube 640, recomendado 3840)")
        if peso > 50: notas.append("⚠ pesa más de 50 MB")
        if peso > 2: notas.append("(>2 MB: para subir desde el móvil usa la versión .jpg)")
        print(" · ".join(notas))
        grande = im.resize((1280, int(1280 * h / w)), Image.LANCZOS)
        movil = im.resize((168, int(168 * h / w)), Image.LANCZOS)
        filas.append((Path(ruta).stem, grande, movil))
    ancho = 1280 + 40 + 336 + 60
    alto = sum(g.height + 90 for _, g, _ in filas) + 20
    lienzo = Image.new("RGB", (ancho, alto), (24, 24, 28))
    d = ImageDraw.Draw(lienzo)
    y = 20
    for nombre, g, m in filas:
        d.text((20, y), nombre, fill=(240, 240, 240), font=fuente(28))
        y += 45
        lienzo.paste(g, (20, y))
        # zona de la duración (abajo a la derecha)
        d.rectangle([20 + g.width - 130, y + g.height - 55, 20 + g.width - 8, y + g.height - 10], outline=(255, 60, 60), width=3)
        x2 = 20 + 1280 + 40
        d.text((x2, y - 40), "tamaño móvil (168 px) · real y x2", fill=(180, 180, 180), font=fuente(20))
        lienzo.paste(m, (x2, y))
        lienzo.paste(m.resize((336, m.height * 2), Image.NEAREST), (x2, y + m.height + 20))
        y += g.height + 45
    no_pisar(a.imagenes[0], a.salida)
    lienzo.save(a.salida)
    print(f"Comparativa en {a.salida} (recuadro rojo = zona de la duración)")


def cmd_exportar(a):
    im = Image.open(a.imagen).convert("RGB")
    sal = Path(a.imagen).with_suffix(".jpg")
    for q in (95, 92, 90, 88, 85, 82, 80):
        im.save(sal, quality=q, optimize=True, progressive=True, subsampling=0 if q >= 90 else 2)
        if os.path.getsize(sal) <= 1.95e6:
            break
    else:
        im.resize((2560, 1440), Image.LANCZOS).save(sal, quality=88, optimize=True)
    print(f"{sal}: {os.path.getsize(sal)/1e6:.2f} MB (apta para subir desde el móvil, límite 2 MB)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("recortar"); s.add_argument("foto"); s.add_argument("salida"); s.add_argument("--borde", type=int, default=0); s.set_defaults(f=cmd_recortar)
    s = sp.add_parser("mascara"); s.add_argument("foto"); s.add_argument("salida"); s.add_argument("--crecer", type=int, default=25); s.set_defaults(f=cmd_mascara)
    s = sp.add_parser("borrar"); s.add_argument("foto"); s.add_argument("mascara", nargs="?"); s.add_argument("salida")
    s.add_argument("--caja", action="append"); s.set_defaults(f=cmd_borrar)
    s = sp.add_parser("caras"); s.add_argument("foto"); s.set_defaults(f=cmd_caras)
    s = sp.add_parser("cambiar-cara"); s.add_argument("mi_cara"); s.add_argument("destino"); s.add_argument("salida")
    s.add_argument("--indice", type=int, default=0); s.add_argument("--sin-mejora", action="store_true"); s.set_defaults(f=cmd_cambiar_cara)
    s = sp.add_parser("igualar-luz"); s.add_argument("recorte"); s.add_argument("referencia"); s.add_argument("salida")
    s.add_argument("--fuerza", type=float, default=0.6); s.set_defaults(f=cmd_igualar_luz)
    s = sp.add_parser("revisar"); s.add_argument("imagenes", nargs="+"); s.add_argument("--salida", required=True); s.set_defaults(f=cmd_revisar)
    s = sp.add_parser("exportar"); s.add_argument("imagen"); s.set_defaults(f=cmd_exportar)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
