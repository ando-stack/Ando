"""Descompone cada imagen de /test-images y la compara con su «verdad» (JSON).
Genera test-images/resultados/<nombre>/ (capas + reconstrucción), una lámina comparativa
y test-images/resultados/informe.md con las métricas.

Uso:  python scripts/evaluar_descomposicion.py [filtro]
"""
from __future__ import annotations

import difflib
import json
import shutil
import sys
import time
import unicodedata
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from engine import device, layers  # noqa: E402

DEST = RAIZ / "test-images" / "resultados"


def norm(t: str) -> str:
    return unicodedata.normalize("NFC", t.strip().upper())


def delta_e(a: str, b: str) -> float:
    ca = np.uint8([[[int(a[i:i + 2], 16) for i in (1, 3, 5)]]])
    cb = np.uint8([[[int(b[i:i + 2], 16) for i in (1, 3, 5)]]])
    la = cv2.cvtColor(ca, cv2.COLOR_RGB2LAB)[0, 0].astype(float)
    lb = cv2.cvtColor(cb, cv2.COLOR_RGB2LAB)[0, 0].astype(float)
    return float(np.linalg.norm(la - lb))


def lamina(original: np.ndarray, recon: np.ndarray, capas: list[dict], carpeta: Path, salida: Path):
    H = 300
    def r(a):
        return cv2.resize(a, (int(a.shape[1] * H / a.shape[0]), H))
    piezas = [r(original), r(recon)]
    tablero = np.zeros((H, H, 3), np.uint8)
    for c in capas:
        if c["type"] != "image" or c["role"] in ("original",):
            continue
        p = carpeta / Path(c["src"]).name
        im = np.asarray(Image.open(p).convert("RGBA"))
        esc = H / max(im.shape[:2])
        im = cv2.resize(im, (max(1, int(im.shape[1] * esc)), max(1, int(im.shape[0] * esc))))
        bg = np.zeros((H, H, 3), np.uint8)
        bg[(np.indices((H, H)).sum(0) // 15) % 2 == 0] = 70
        bg[(np.indices((H, H)).sum(0) // 15) % 2 == 1] = 40
        a = im[..., 3:4] / 255
        h, w = im.shape[:2]
        bg[:h, :w] = (bg[:h, :w] * (1 - a) + im[..., :3] * a).astype(np.uint8)
        pil = Image.fromarray(bg)
        ImageDraw.Draw(pil).text((5, H - 18), f"{c['name']} ({c['confidence']})", fill=(255, 255, 0))
        piezas.append(np.asarray(pil))
    Image.fromarray(np.hstack(piezas)).save(salida, quality=85)


def main(filtro: str = ""):
    DEST.mkdir(parents=True, exist_ok=True)
    filas = []
    resumen = []
    for js in sorted((RAIZ / "test-images").glob("0*.json")):
        if filtro and filtro not in js.stem:
            continue
        verdad = json.loads(js.read_text("utf-8"))
        ruta = RAIZ / "test-images" / verdad["archivo"]
        img, _ = layers.cargar_imagen(ruta.read_bytes())
        carpeta = DEST / js.stem
        shutil.rmtree(carpeta, ignore_errors=True)
        alm = layers.Almacen(carpeta, f"/r/{js.stem}")
        t = time.time()
        res = layers.descomponer(img, alm)
        dur = time.time() - t
        layers.guardar_json(carpeta / "proyecto.json", res.proyecto)
        capas = res.proyecto["layers"]
        textos = [c for c in capas if c["type"] == "text"]
        # emparejado de textos
        aciertos_txt, sim_txt, fuente_top3, fuente_top1, de_relleno, contorno_ok = 0, [], 0, 0, [], 0
        for v in verdad["textos"]:
            mejor, s_m = None, 0.0
            for c in textos:
                s = difflib.SequenceMatcher(None, norm(v["texto"]), norm(c["text"])).ratio()
                if s > s_m:
                    mejor, s_m = c, s
            sim_txt.append(s_m)
            if mejor is None or s_m < 0.5:
                continue
            aciertos_txt += s_m == 1.0
            fams = [f["familia"] for f in mejor["fontCandidates"]]
            fuente_top3 += v["familia"] in fams
            fuente_top1 += bool(fams) and fams[0] == v["familia"]
            ref = v.get("relleno") or v["degradado"][0]
            de_relleno.append(delta_e(ref, mejor["fill"]["color"]))
            contorno_ok += len(v["contornos"]) == len(mejor["strokes"])
        n = len(verdad["textos"])
        recon = np.asarray(Image.open(carpeta / "reconstruccion.png").convert("RGB"))
        lamina(img, recon, capas, carpeta, DEST / f"{js.stem}.jpg")
        m = res.metricas
        sujetos = sum(1 for c in capas if c["role"] in ("sujeto", "objeto"))
        graf = sum(1 for c in capas if c["role"] == "grafico")
        fila = {
            "imagen": verdad["archivo"],
            "segundos": round(dur, 1),
            "ssim": m["ssim"],
            "psnr": m["psnr"],
            "textos_exactos": f"{aciertos_txt}/{n}",
            "similitud_texto": round(float(np.mean(sim_txt)), 3) if sim_txt else 1.0,
            "fuente_top1": f"{fuente_top1}/{n}",
            "fuente_top3": f"{fuente_top3}/{n}",
            "dE_relleno": round(float(np.mean(de_relleno)), 1) if de_relleno else None,
            "contornos_ok": f"{contorno_ok}/{n}",
            "sujetos": f"{sujetos} (esperados {verdad['sujetos']})",
            "graficos": f"{graf} (esperados {len(verdad['graficos'])})",
            "capas_texto_imagen": sum(1 for c in capas if c["role"] == "texto-imagen"),
        }
        filas.append(fila)
        resumen.append({"fila": fila, "textos": [(c["text"], c["fontFamily"], c["fill"]["color"], [s["color"] + "/" + str(s["width"]) for s in c["strokes"]], c.get("fidelity"), c["visible"]) for c in textos], "avisos": res.avisos, "tiempos": m["tiempos_s"]})
        print(json.dumps(fila, ensure_ascii=False))
    if not filtro:
        info = device.info()
        lineas = [
            "# Resultados de la descomposición",
            "",
            f"Equipo: {info['nombre']} ({info['dispositivo']}), {info['hilos_cpu']} hilos, PyTorch {info['torch']}.",
            "",
            "| Imagen | s | SSIM | PSNR | Textos exactos | Similitud texto | Fuente top-1 | Fuente top-3 | ΔE relleno | Nº contornos ok | Sujetos | Gráficos | Textos como imagen |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for f in filas:
            lineas.append("| " + " | ".join(str(f[k]) for k in ["imagen", "segundos", "ssim", "psnr", "textos_exactos", "similitud_texto", "fuente_top1", "fuente_top3", "dE_relleno", "contornos_ok", "sujetos", "graficos", "capas_texto_imagen"]) + " |")
        lineas += ["", "## Detalle", ""]
        for r in resumen:
            lineas.append(f"### {r['fila']['imagen']}")
            lineas.append("")
            lineas.append(f"![lámina](./{Path(r['fila']['imagen']).stem}.jpg)")
            lineas.append("")
            lineas.append(f"Tiempos (s): {r['tiempos']}")
            lineas.append("")
            for t in r["textos"]:
                lineas.append(f"- «{t[0]}» → {t[1]}, relleno {t[2]}, contornos {t[3]}, fidelidad {t[4]}, visible={t[5]}")
            for a in r["avisos"]:
                lineas.append(f"- Aviso: {a}")
            lineas.append("")
        (DEST / "informe.md").write_text("\n".join(lineas), "utf-8")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
