"""Fase 3: análisis de color y generación de un LUT 3D (.cube) natural.

El LUT combina, por este orden: balance de blancos, exposición (curva gamma que nunca
quema altas luces ni empasta sombras porque 0->0 y 1->1), contraste (curva S suave con
extremos fijos), saturación y los ajustes manuales. La intensidad mezcla con el original.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional

import numpy as np

from config import (COLOR_LUMA_RANGE, COLOR_MAX_TEMP_BIAS, COLOR_MAX_TINT_BIAS, COLOR_MIN_CONTRAST,
                    COLOR_SAT_RANGE, COLOR_TARGET_LUMA, LUT_SIZE)
from utils import run

LUMA_W = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


# ====================================================================== muestreo
def sample_frames(video: Path, duration: float, n: int = 8, width: int = 320) -> list[np.ndarray]:
    """Fotogramas RGB float (0..1) repartidos por el clip."""
    frames = []
    for i in range(n):
        t = duration * (i + 0.5) / n
        proc = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                               "-vf", f"scale={width}:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                              capture_output=True)
        if proc.returncode != 0 or not proc.stdout:
            continue
        data = np.frombuffer(proc.stdout, np.uint8)
        h = data.size // (width * 3)
        if h:
            frames.append(data[: h * width * 3].reshape(h, width, 3).astype(np.float32) / 255.0)
    return frames


# ====================================================================== análisis
def analyze(frames: list[np.ndarray]) -> dict:
    px = np.concatenate([f.reshape(-1, 3) for f in frames]) if frames else np.zeros((1, 3), np.float32)
    luma = px @ LUMA_W
    mx, mn = px.max(1), px.min(1)
    chroma = mx - mn                       # croma (más perceptual que la S de HSV)
    sat = chroma
    # balance de blancos: promedio de los píxeles casi neutros (grises/blancos de la escena).
    # Si la escena apenas tiene neutros (atardecer, playa...), no se juzga el balance.
    neutral = (luma > 0.08) & (luma < 0.92) & (chroma < 0.2)
    bright = (luma >= np.percentile(luma, 90)) & (luma < 0.97) & (chroma < 0.2)   # "parche blanco"
    est = []
    if neutral.mean() > 0.03:
        est.append(px[neutral].mean(0))
    if bright.sum() > 200:
        est.append(px[bright].mean(0))
    temp_bias = tint_bias = 0.0
    mean = px.mean(0)
    if est:
        # Conservador: si los dos estimadores no coinciden en el sentido, no se corrige
        temps = [float((m[0] - m[2]) / (m.sum() + 1e-6)) for m in est]
        tints = [float(((m[0] + m[2]) / 2 - m[1]) / (m.sum() + 1e-6)) for m in est]
        pick = lambda v: (min(v, key=abs) if len(v) == 1 or v[0] * v[1] > 0 else 0.0) * (1 if len(v) == 2 else 0.8)
        temp_bias, tint_bias = pick(temps), pick(tints)
        mean = np.mean(est, 0)
    res = {
        "luma": round(float(luma.mean()), 4),
        "contrast": round(float(luma.std()), 4),
        "saturation": round(float(sat.mean()), 4),
        "tempBias": round(temp_bias, 4),
        "tintBias": round(tint_bias, 4),
        "clippedHigh": round(float((luma > 0.98).mean()), 4),
        "clippedLow": round(float((luma < 0.02).mean()), 4),
        "p02": round(float(np.percentile(luma, 2)), 4),
        "p98": round(float(np.percentile(luma, 98)), 4),
        "gains": [round(float(x), 4) for x in (mean.mean() / np.maximum(mean, 1e-3))],
    }
    issues = []
    if res["luma"] < COLOR_LUMA_RANGE[0]:
        issues.append("imagen oscura (subexpuesta)")
    elif res["luma"] > COLOR_LUMA_RANGE[1]:
        issues.append("imagen demasiado clara (sobreexpuesta)")
    if res["contrast"] < COLOR_MIN_CONTRAST:
        issues.append("poco contraste")
    if temp_bias < -COLOR_MAX_TEMP_BIAS:
        issues.append("dominante fría (azulada)")
    elif temp_bias > COLOR_MAX_TEMP_BIAS * 1.4:  # se tolera algo más de calidez
        issues.append("dominante cálida (anaranjada)")
    if abs(tint_bias) > COLOR_MAX_TINT_BIAS:
        issues.append("dominante " + ("magenta" if tint_bias > 0 else "verde"))
    if res["saturation"] < COLOR_SAT_RANGE[0]:
        issues.append("colores apagados")
    elif res["saturation"] > COLOR_SAT_RANGE[1]:
        issues.append("colores sobresaturados")
    return {"analysis": {k: res[k] for k in ("luma", "contrast", "saturation", "tempBias", "tintBias",
                                              "clippedHigh", "clippedLow")} | {"issues": issues},
            "raw": res}


# ====================================================================== corrección
def correction_params(raw: dict, issues: list[str]) -> dict:
    """Parámetros automáticos (suaves) a partir del análisis."""
    p = {"gains": [1.0, 1.0, 1.0], "gamma": 1.0, "contrast": 0.0, "saturation": 1.0, "black": [0.0, 0.0, 0.0]}
    if any(i.startswith("dominante") for i in issues):
        g = np.array(raw["gains"], np.float32)
        g = 1 + (g - 1) * 0.8                       # corrección del 80 %: queda natural
        g = g / float(g @ LUMA_W)                    # sin cambiar la luminancia
        p["gains"] = [float(x) for x in np.clip(g, 0.6, 1.6)]
    luma = raw["luma"]
    if luma < COLOR_LUMA_RANGE[0] or luma > COLOR_LUMA_RANGE[1]:
        gamma = np.log(COLOR_TARGET_LUMA) / np.log(max(min(luma, 0.95), 0.03))
        p["gamma"] = float(np.clip(gamma, 0.4, 1.8))  # <1 aclara, >1 oscurece
    if raw["contrast"] < COLOR_MIN_CONTRAST:
        p["contrast"] = float(np.clip((COLOR_MIN_CONTRAST - raw["contrast"]) * 3.0, 0.05, 0.35))
    sat = raw["saturation"]
    if sat < COLOR_SAT_RANGE[0]:
        p["saturation"] = float(np.clip(COLOR_SAT_RANGE[0] / max(sat, 0.03), 1.0, 1.35))
    elif sat > COLOR_SAT_RANGE[1]:
        p["saturation"] = float(np.clip(COLOR_SAT_RANGE[1] / sat, 0.75, 1.0))
    # Al aclarar, la saturación aparente baja: compensamos un poco
    if p["gamma"] < 0.9:
        p["saturation"] *= 1.05
    return p


def apply_transform(rgb: np.ndarray, params: dict, manual: dict, intensity: float) -> np.ndarray:
    """Aplica la corrección a un array (..., 3) de valores 0..1. Usado para el LUT y para verificar."""
    x = rgb.astype(np.float32)
    blk = np.array(params.get("black", [0, 0, 0]), np.float32)
    out = np.clip((x - blk) / (1 - blk), 0, None)          # neutraliza el negro sin mover el blanco
    out = out * np.array(params["gains"], np.float32)
    # temperatura manual: cálido sube R y baja B
    t = manual.get("temperature", 0.0)
    if t:
        out = out * np.array([1 + 0.12 * t, 1 + 0.02 * t, 1 - 0.12 * t], np.float32)
    out = np.clip(out, 0, None)
    # exposición: curva gamma por canal (0->0 y 1->1: no quema altas luces ni empasta sombras)
    gamma = params["gamma"] * (2 ** (-manual.get("exposure", 0.0) * 0.8))
    out = np.minimum(out, 1.2)
    out = np.where(out <= 1.0, np.power(np.clip(out, 0, 1), gamma), out)
    # compresión suave de altas luces para no quemar
    out = np.where(out > 0.9, 0.9 + (1 - np.exp(-(out - 0.9) * 10)) * 0.1, out)
    # contraste: curva S con extremos fijos
    c = params["contrast"] + manual.get("contrast", 0.0) * 0.35
    if c:
        out = out - c * np.sin(2 * np.pi * out) / (2 * np.pi)
    # saturación
    s = params["saturation"] * (1 + manual.get("saturation", 0.0) * 0.6)
    if s != 1:
        y = (out @ LUMA_W)[..., None]
        out = y + (out - y) * s
    out = np.clip(out, 0, 1)
    return x + (out - x) * float(intensity)


def write_cube(path: Path, params: dict, manual: dict, intensity: float, size: int = LUT_SIZE, title: str = "Corrección"):
    g = np.linspace(0, 1, size, dtype=np.float32)
    # Formato .cube: el canal rojo varía más rápido
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    grid = np.stack([r, gg, b], -1).reshape(-1, 3)
    out = apply_transform(grid, params, manual, intensity)
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {size}", "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"]
    lines += [f"{v[0]:.6f} {v[1]:.6f} {v[2]:.6f}" for v in out]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply_lut_ffmpeg(src: Path, dst: Path, lut: Path, proj_dir: Path, duration: float, quality: str = "proxy",
                     progress=None, cancel=None, codec: str = "h264"):
    dst.parent.mkdir(parents=True, exist_ok=True)
    rel_lut = lut.relative_to(proj_dir).as_posix()
    from ingest import video_codec_args
    if quality == "proxy":
        venc = video_codec_args(codec, "proxy")
    else:  # versión para el render: H.264 de alta calidad
        venc = ["-c:v", "libx264", "-preset", "medium", "-crf", "14", "-g", "60", "-movflags", "+faststart"]
    cmd = ["ffmpeg", "-y", "-i", str(src.relative_to(proj_dir) if src.is_relative_to(proj_dir) else src),
           "-map", "0:v:0", "-an", "-vf", f"lut3d=file={rel_lut}:interp=tetrahedral,format=yuv420p",
           *venc, str(dst.relative_to(proj_dir))]
    # se ejecuta con cwd=proyecto para que la ruta del LUT no necesite escapes
    run(cmd, proj_dir, f"aplicar LUT {src.name}", duration, progress, cancel, cwd=proj_dir)


# ====================================================================== flujo completo
def analyze_project(proj_dir: Path, p: dict) -> tuple[dict, dict]:
    frames = []
    for s in p["sources"]:
        frames += sample_frames(proj_dir / s["proxy"], s["duration"], n=max(3, min(10, int(s["duration"] / 3))))
    return analyze(frames)["analysis"], analyze(frames)["raw"]


def has_manual(color: dict) -> bool:
    return any(abs(color.get(k, 0)) > 1e-3 for k in ("temperature", "exposure", "contrast", "saturation"))


def build_and_apply(proj_dir: Path, p: dict, job=None, force_analyze: bool = False) -> dict:
    """Analiza (si hace falta), genera lut.cube y las versiones corregidas de los proxies.
    Devuelve el proyecto modificado."""
    color = p["color"]
    if force_analyze or not color.get("analyzed"):
        if job:
            job.update(message="Analizando la iluminación y el color")
        analysis, raw = analyze_project(proj_dir, p)
        color["analysis"] = analysis
        color["analyzed"] = True
        color["needsCorrection"] = bool(analysis["issues"])
        color["_raw"] = raw
        if color["needsCorrection"] and force_analyze:
            color["enabled"] = True
    raw = color.pop("_raw", None)
    if raw is None:
        _a, raw = analyze_project(proj_dir, p)
    issues = color["analysis"]["issues"] if color.get("analysis") else []
    manual = {k: color.get(k, 0.0) for k in ("temperature", "exposure", "contrast", "saturation")}
    if not color["needsCorrection"] and not has_manual(color):
        color["enabled"] = False
        color["message"] = "La iluminación y el color ya son correctos: no se aplica ninguna corrección."
        for s in p["sources"]:
            s["corrected"] = None
            s["correctedProxy"] = None
        return p
    if not color["enabled"]:
        color["message"] = ("Se detectó: " + ", ".join(issues) + ". Corrección desactivada.") if issues else \
            "Corrección desactivada."
        return p
    params = correction_params(raw, issues) if color["needsCorrection"] else \
        {"gains": [1.0, 1.0, 1.0], "gamma": 1.0, "contrast": 0.0, "saturation": 1.0, "black": [0.0, 0.0, 0.0]}
    # Cada versión del LUT se guarda aparte (deshacer vuelve a una versión anterior que sigue existiendo);
    # lut.cube en la carpeta del proyecto es siempre la versión en uso, para reutilizarla en otros programas.
    color["version"] = int(color.get("version", 0)) + 1
    v = color["version"]
    lut = proj_dir / "luts" / f"lut_v{v}.cube"
    lut.parent.mkdir(exist_ok=True)
    write_cube(lut, params, manual, color["intensity"], title="Correccion automatica")
    import shutil
    shutil.copy(lut, proj_dir / "lut.cube")
    color["lutFile"] = f"luts/lut_v{v}.cube"
    n = len(p["sources"])
    for i, s in enumerate(p["sources"]):
        if job:
            job.update(i / n, f"Aplicando LUT a {s['name']}")
        codec = p.get("previewCodec", "h264")
        rel = f"corregidos/{s['id']}_proxy_v{v}{'.webm' if codec == 'vp9' else '.mp4'}"
        apply_lut_ffmpeg(proj_dir / s["proxy"], proj_dir / rel, lut, proj_dir, s["duration"], "proxy",
                         job.sub(i / n, (i + 1) / n) if job else None, job.cancel_event if job else None, codec)
        s["correctedProxy"] = rel
        s["corrected"] = None   # la versión a resolución completa se genera al exportar
    # verificación: analizar el resultado
    frames = []
    for s in p["sources"]:
        frames += sample_frames(proj_dir / s["correctedProxy"], s["duration"], n=3)
    after = analyze(frames)["analysis"]
    color["message"] = (("Se detectó: " + ", ".join(issues) + ". " if issues else "") +
                        f"LUT aplicado (luminancia {color['analysis']['luma']:.2f} → {after['luma']:.2f}). "
                        f"Puedes reutilizar lut.cube en otros programas.")
    return p


def ensure_full_res(proj_dir: Path, p: dict, job=None, start=0.0, end=1.0) -> dict:
    """Para exportar: genera el original corregido a resolución completa si hay LUT activo."""
    color = p["color"]
    if not (color.get("enabled") and color.get("lutFile") and p["tracks"]["color"]["enabled"]):
        return p
    lut = proj_dir / color["lutFile"]
    n = len(p["sources"])
    for i, s in enumerate(p["sources"]):
        rel = f"corregidos/{s['id']}_full_v{color['version']}.mp4"
        if not (proj_dir / rel).exists():
            if job:
                job.update(message=f"Aplicando LUT a resolución completa: {s['name']}")
            apply_lut_ffmpeg(proj_dir / s["original"], proj_dir / rel, lut, proj_dir, s["duration"], "full",
                             job.sub(start + (end - start) * i / n, start + (end - start) * (i + 1) / n) if job else None,
                             job.cancel_event if job else None)
        s["corrected"] = rel
    return p
