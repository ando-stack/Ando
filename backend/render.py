"""Fase 7: exportación con Remotion (@remotion/renderer) usando los archivos originales.

El render usa la MISMA composición que la previsualización (frontend/src/remotion), por eso lo
que se ve es lo que se exporta. Solo cambian las fuentes: proxies -> originales/corregidos."""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
from datetime import datetime
from pathlib import Path

import audio
import color
import faces
import project_ops as ops
from config import FRONTEND_DIR, PUBLIC_URL, REMOTION_BROWSER, RENDER_CONCURRENCY
from utils import Cancelled, FFmpegError, fmt_time, run, write_log

REMOTION_CODECS = {"h264", "hevc", "vp8", "vp9", "av1", "prores"}

PRESETS = {
    "16x9-1080": {"label": "Horizontal 16:9 · 1080p", "width": 1920, "height": 1080, "aspect": "16:9"},
    "16x9-4k": {"label": "Horizontal 16:9 · 4K", "width": 3840, "height": 2160, "aspect": "16:9"},
    "9x16-1080": {"label": "Vertical 9:16 · 1080×1920", "width": 1080, "height": 1920, "aspect": "9:16"},
}


def available_presets(p: dict) -> list[dict]:
    max_h = max((min(s["width"], s["height"]) if s["width"] > s["height"] else s["height"] for s in p["sources"]), default=0)
    out = []
    for k, v in PRESETS.items():
        ok = k != "16x9-4k" or max_h >= 2160
        out.append({"id": k, **v, "available": ok,
                    "reason": "" if ok else "el original no tiene resolución 4K"})
    return out


# ====================================================================== srt
def to_srt(p: dict) -> str:
    def ts(t):
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    lines = []
    for i, b in enumerate(sorted(p["captions"]["blocks"], key=lambda b: b["start"]), 1):
        lines += [str(i), f"{ts(b['start'])} --> {ts(b['end'])}", " ".join(w["text"] for w in b["words"]), ""]
    return "\n".join(lines)


# ====================================================================== preparación de medios
def ensure_masters(proj_dir: Path, p: dict, job, start: float, end: float) -> dict:
    """Originales con rotación o códecs no soportados por Remotion -> máster H.264 de alta calidad."""
    n = len(p["sources"])
    for i, s in enumerate(p["sources"]):
        if s.get("corrected"):
            continue
        if s["videoCodec"] in REMOTION_CODECS and s["rotation"] == 0:
            continue
        rel = f"masters/{s['id']}.mp4"
        if not (proj_dir / rel).exists():
            job.update(message=f"Preparando {s['name']} para el render")
            (proj_dir / "masters").mkdir(exist_ok=True)
            run(["ffmpeg", "-y", "-i", str(proj_dir / s["original"]), "-map", "0:v:0", "-an", "-c:v", "libx264",
                 "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", str(proj_dir / rel)],
                proj_dir, f"máster {s['name']}", s["duration"],
                job.sub(start + (end - start) * i / n, start + (end - start) * (i + 1) / n), job.cancel_event)
        s["master"] = rel
    return p


def compute_reframe(proj_dir: Path, p: dict, job=None) -> dict:
    """Centro horizontal de la persona principal en cada clip, muy suavizado (para 9:16)."""
    import numpy as np
    if not p["faces"]["analyzed"]:
        p = faces.analyze_project(proj_dir, p, job)
    parts = []
    main = p["faces"]["tracks"][0] if p["faces"]["tracks"] else None
    for s in p["sources"]:
        samples = []
        if main:
            for part in main["parts"]:
                if part["sourceId"] == s["id"]:
                    samples = [(x["t"], x["x"] + x["w"] / 2) for x in part["samples"]]
        if not samples:
            parts.append({"sourceId": s["id"], "samples": [{"t": 0.0, "x": 0.5}]})
            continue
        ts = np.array([a for a, _ in samples])
        xs = np.array([b for _, b in samples])
        k = min(len(xs), 21)
        if k >= 3:
            pad = np.pad(xs, (k // 2, k // 2), mode="edge")
            xs = np.convolve(pad, np.ones(k) / k, mode="valid")
        step = max(1, len(ts) // 60)
        parts.append({"sourceId": s["id"], "samples": [{"t": round(float(t), 3), "x": round(float(x), 4)}
                                                       for t, x in zip(ts[::step], xs[::step])]})
    p["reframe"]["parts"] = parts
    return p


# ====================================================================== render
def render_props(name: str, p: dict, preset: dict, mode: str = "render") -> dict:
    base = f"{PUBLIC_URL}/files/{name}/"
    return {"project": p, "media": {"baseUrl": base, "assetsUrl": f"{PUBLIC_URL}/assets/", "mode": mode},
            "output": {"width": preset["width"], "height": preset["height"], "aspect": preset["aspect"]}}


def run_remotion(props_file: Path, out: Path, proj_dir: Path, job, start: float, end: float, extra: list[str] | None = None):
    script = FRONTEND_DIR / "render" / "render.mjs"
    cmd = ["node", str(script), str(props_file), str(out)] + (extra or [])
    env = None
    if REMOTION_BROWSER or RENDER_CONCURRENCY:
        import os
        env = dict(os.environ)
        if REMOTION_BROWSER:
            env["REMOTION_BROWSER_EXECUTABLE"] = REMOTION_BROWSER
        if RENDER_CONCURRENCY:
            env["RENDER_CONCURRENCY"] = RENDER_CONCURRENCY
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=FRONTEND_DIR, env=env)
    log: list[str] = []

    def watch_cancel():
        job.cancel_event.wait()
        if proc.poll() is None:
            proc.kill()

    threading.Thread(target=watch_cancel, daemon=True).start()
    for line in proc.stdout:
        log.append(line)
        if line.startswith("PROGRESS "):
            try:
                job.update(start + (end - start) * float(line.split()[1]))
            except ValueError:
                pass
        elif line.startswith("STAGE "):
            job.update(message=line[6:].strip())
    proc.wait()
    if job.cancel_event.is_set():
        raise Cancelled()
    if proc.returncode != 0:
        f = write_log(proj_dir, "render remotion", cmd, "".join(log))
        tail = "".join(l for l in log[-15:] if not l.startswith("PROGRESS"))
        raise FFmpegError(f"Falló el render (detalles en logs/{f.name if f else ''}): {tail[-600:]}", f)


def export(name: str, preset_id: str, job) -> dict:
    proj_dir = ops.project_dir(name)
    p = ops.load_dict(name)
    if not p["segments"]:
        raise ValueError("El proyecto no tiene vídeo")
    preset = PRESETS[preset_id]
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = proj_dir / "exportaciones" / f"{stamp}-{preset_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    job.update(0.01, "Preparando audio")
    for s in p["sources"]:
        if s.get("hasAudio") and not s.get("audio"):
            s["audio"] = audio.process_source_audio(proj_dir, s, p["audio"]["normalize"], p["audio"]["denoise"],
                                                    job.cancel_event, p.get("previewCodec", "h264"))
    job.update(0.03, "Preparando color")
    p = color.ensure_full_res(proj_dir, p, job, 0.03, 0.2)
    p = ensure_masters(proj_dir, p, job, 0.2, 0.25)
    if preset["aspect"] == "9:16" and any(s["width"] > s["height"] for s in p["sources"]) and p["reframe"]["auto"] \
            and not p["reframe"]["parts"]:
        job.update(0.25, "Reencuadre vertical: buscando a la persona que habla")
        p = compute_reframe(proj_dir, p, job)
        saved = ops.load_dict(name)
        saved["reframe"] = p["reframe"]
        saved["faces"] = p["faces"]
        ops.save(name, saved)
    props = render_props(name, p, preset)
    props_file = out_dir / "render-props.json"
    props_file.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
    video = out_dir / f"{name}-{preset_id}.mp4"
    job.update(0.3, "Renderizando con Remotion")
    run_remotion(props_file, video, proj_dir, job, 0.3, 0.98)
    props_file.unlink(missing_ok=True)
    (out_dir / f"{name}.srt").write_text(to_srt(p), encoding="utf-8")
    shutil.copy(proj_dir / "project.json", out_dir / "project.json")
    files = [video.name, f"{name}.srt", "project.json"]
    if p["color"].get("lutFile") and (proj_dir / p["color"]["lutFile"]).exists() and p["color"]["enabled"]:
        shutil.copy(proj_dir / p["color"]["lutFile"], out_dir / "lut.cube")
        files.append("lut.cube")
    job.update(1.0, f"Exportado ({fmt_time(ops.duration(p))})")
    rel = out_dir.relative_to(proj_dir).as_posix()
    return {"folder": rel, "files": [f"{rel}/{f}" for f in files], "video": f"{rel}/{video.name}"}


def list_exports(name: str) -> list[dict]:
    d = ops.project_dir(name) / "exportaciones"
    if not d.exists():
        return []
    out = []
    for sub in sorted(d.iterdir(), reverse=True):
        if sub.is_dir():
            files = sorted(f.name for f in sub.iterdir() if f.is_file() and f.name != "render-props.json")
            out.append({"folder": f"exportaciones/{sub.name}", "files": [f"exportaciones/{sub.name}/{f}" for f in files]})
    return out
