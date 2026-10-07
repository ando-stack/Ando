"""Fase 1: análisis de clips (ffprobe), proxies, agrupación y unión en proyectos."""
from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

import transcribe
from config import (GROUP_LINK_THRESHOLD, GROUP_MAX_GAP_SECONDS, GROUP_WEIGHTS, PROJECTS_DIR,
                    PROXY_CRF, PROXY_HEIGHT)
from utils import FFmpegError, ffprobe, new_id, now_iso, run, slugify

IMPORTS_DIR = PROJECTS_DIR / "_importaciones"


# ====================================================================== análisis
def _parse_fps(rate: str) -> float:
    try:
        n, d = rate.split("/")
        return float(n) / float(d) if float(d) else 0.0
    except (ValueError, ZeroDivisionError):
        return 0.0


def _parse_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y:%m:%d %H:%M:%S"):
        try:
            d = datetime.fromisoformat(v) if fmt is None else datetime.strptime(v[:19], fmt)
            return d.isoformat()
        except ValueError:
            continue
    return None


def probe(path: Path) -> dict:
    """Duración, resolución, fps, códecs, rotación, fecha de creación, dispositivo y audio."""
    info = ffprobe(path)
    fmt = info.get("format", {})
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        raise FFmpegError(f"{path.name} no contiene pista de vídeo")
    rotation = 0
    tags = {**fmt.get("tags", {}), **v.get("tags", {})}
    tags_l = {k.lower(): val for k, val in tags.items()}
    if "rotate" in tags_l:
        rotation = int(float(tags_l["rotate"]))
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(float(sd["rotation"]))
    rotation = rotation % 360
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    if rotation in (90, 270):
        w, h = h, w
    fps = _parse_fps(v.get("avg_frame_rate", "0/1")) or _parse_fps(v.get("r_frame_rate", "0/1")) or 30.0
    duration = float(fmt.get("duration") or v.get("duration") or 0)
    created = (_parse_date(tags_l.get("com.apple.quicktime.creationdate"))
               or _parse_date(tags_l.get("creation_time")) or _parse_date(tags_l.get("date")))
    device = (tags_l.get("com.apple.quicktime.model") or tags_l.get("com.android.model")
              or tags_l.get("model") or tags_l.get("make") or None)
    return {
        "duration": round(duration, 3), "width": w, "height": h, "fps": round(fps, 3),
        "rotation": rotation, "videoCodec": v.get("codec_name", ""),
        "audioCodec": a.get("codec_name", "") if a else "", "hasAudio": a is not None,
        "creationTime": created, "device": device, "size": int(fmt.get("size") or 0),
    }


PROXY_EXT = {"h264": ".mp4", "vp9": ".webm"}


def video_codec_args(codec: str, quality: str = "proxy") -> list[str]:
    """H.264 (por defecto) o VP9 para navegadores sin códecs propietarios (p. ej. Chromium en Linux)."""
    if codec == "vp9":
        crf = "36" if quality == "proxy" else "30"
        return ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
                "-b:v", "0", "-crf", crf, "-g", "15"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(PROXY_CRF if quality == "proxy" else 26),
            "-g", "15", "-movflags", "+faststart"]


def audio_codec_args(codec: str) -> list[str]:
    return ["-c:a", "libopus", "-b:a", "128k"] if codec == "vp9" else ["-c:a", "aac", "-b:a", "128k"]


def make_proxy(src: Path, dst: Path, meta: dict, proj_dir: Path, progress=None, cancel=None, codec: str = "h264"):
    """Proxy ligero (540p) para que la previsualización vaya fluida."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    h = min(PROXY_HEIGHT, meta["height"]) // 2 * 2
    cmd = ["ffmpeg", "-y", "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?",
           "-vf", f"scale=-2:{h},format=yuv420p", *video_codec_args(codec), *audio_codec_args(codec),
           "-ac", "2", str(dst)]
    run(cmd, proj_dir, f"proxy {src.name}", meta["duration"], progress, cancel)


def extract_analysis_audio(src: Path, dst: Path, meta: dict, proj_dir: Path, cancel=None):
    """WAV mono 16 kHz para transcripción y detección de silencios."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if meta["hasAudio"]:
        cmd = ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)]
    else:  # clip sin audio: silencio de la misma duración
        cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", str(meta["duration"]),
               "-c:a", "pcm_s16le", str(dst)]
    run(cmd, proj_dir, f"audio {src.name}", cancel=cancel)


def extract_frame(src: Path, t: float, dst: Path, proj_dir: Path, from_end: bool = False, width: int = 320):
    dst.parent.mkdir(parents=True, exist_ok=True)
    seek = ["-sseof", f"-{max(t, 0.05):.3f}"] if from_end else ["-ss", f"{t:.3f}"]
    run(["ffmpeg", "-y", *seek, "-i", str(src), "-frames:v", "1", "-vf", f"scale={width}:-2",
         "-q:v", "3", str(dst)], proj_dir, f"fotograma {src.name}")


# ====================================================================== señales de agrupación
_num_re = re.compile(r"(\d+)(?!.*\d)")


def name_score(a: str, b: str) -> tuple[float, str]:
    sa, sb = Path(a).stem, Path(b).stem
    ma, mb = _num_re.search(sa), _num_re.search(sb)
    if ma and mb:
        pa, pb = sa[:ma.start()], sb[:mb.start()]
        na, nb = int(ma.group(1)), int(mb.group(1))
        if pa.lower() == pb.lower():
            if nb == na + 1:
                return 1.0, "nombres consecutivos"
            if nb > na and nb - na <= 5:
                return 0.7, "numeración cercana"
            if nb < na:
                return 0.0, "numeración inversa"
            return 0.4, "mismo prefijo"
    return 0.3, ""


def time_score(a: dict, b: dict) -> tuple[float, str]:
    ta, tb = a.get("creationTime"), b.get("creationTime")
    if not ta or not tb:
        return 0.5, ""
    try:
        da, db = datetime.fromisoformat(ta), datetime.fromisoformat(tb)
        if (da.tzinfo is None) != (db.tzinfo is None):
            da, db = da.replace(tzinfo=None), db.replace(tzinfo=None)
    except ValueError:
        return 0.5, ""
    start_gap = (db - da).total_seconds()
    if start_gap <= 0:
        return 0.0, "grabado antes"
    gap = start_gap - a["duration"]           # pausa entre el fin de A y el inicio de B
    if gap < -5:  # algunos móviles guardan la fecha de fin de grabación
        gap = start_gap - b["duration"]
    gap = max(gap, 0.0)
    if gap <= 60:
        return 1.0, f"grabados seguidos ({gap:.0f}s de pausa)"
    if gap <= GROUP_MAX_GAP_SECONDS:
        return 1.0 - 0.6 * gap / GROUP_MAX_GAP_SECONDS, f"{gap / 60:.0f} min de diferencia"
    if gap <= 6 * 3600:
        return 0.2, "varias horas de diferencia"
    return 0.0, "fechas muy distintas"


def format_score(a: dict, b: dict) -> tuple[float, str]:
    s = 0.0
    if (a["width"], a["height"]) == (b["width"], b["height"]):
        s += 0.4
    if abs(a["fps"] - b["fps"]) < 0.5:
        s += 0.3
    if a.get("device") and a.get("device") == b.get("device"):
        s += 0.3
    elif not a.get("device") and not b.get("device"):
        s += 0.15
    return s, "mismo formato" if s >= 0.7 else ""


def _frame_feats(path: Path):
    img = cv2.imread(str(path))
    if img is None:
        return None
    small = cv2.resize(img, (64, 36), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    return hist, gray


def visual_score(last_a: Path, first_b: Path) -> tuple[float, str]:
    fa, fb = _frame_feats(last_a), _frame_feats(first_b)
    if fa is None or fb is None:
        return 0.5, ""
    hist_corr = max(0.0, float(cv2.compareHist(fa[0], fb[0], cv2.HISTCMP_CORREL)))
    pix = 1.0 - min(1.0, float(np.mean(np.abs(fa[1] - fb[1]))) * 4)
    s = 0.6 * hist_corr + 0.4 * pix
    return s, "imagen continua" if s > 0.75 else ""


def text_score_heuristic(a: dict, b: dict) -> tuple[float, str]:
    wa, wb = a.get("words") or [], b.get("words") or []
    if not wa or not wb:
        return 0.5, ""
    last, first = wa[-1], wb[0]
    s = 0.45
    reasons = []
    if a["duration"] - last["end"] < 1.2 and first["start"] < 1.2:
        s += 0.3
        reasons.append("la voz sigue en el corte")
    if not re.search(r"[.!?…]$", last["text"]):
        s += 0.15
        reasons.append("frase sin terminar")
    if first["text"][:1].islower():
        s += 0.1
    return min(s, 1.0), ", ".join(reasons)


def text_scores_claude(clips: dict[str, dict], pairs: list[tuple[str, str]]) -> dict[tuple[str, str], float]:
    """Pide a Claude que valore la continuidad del texto entre pares de clips (solo texto)."""
    import ai_editor
    items = []
    for a, b in pairs:
        ta = transcribe.words_to_text(clips[a].get("words", [])[-25:])
        tb = transcribe.words_to_text(clips[b].get("words", [])[:25])
        if ta and tb:
            items.append({"par": f"{a}>{b}", "final_clip_A": ta, "inicio_clip_B": tb})
    if not items:
        return {}
    res = ai_editor.rate_continuity(items)
    out = {}
    for it in res:
        try:
            a, b = it["par"].split(">")
            out[(a, b)] = float(it["continuidad"])
        except (KeyError, ValueError):
            continue
    return out


def link_score(a: dict, b: dict, text_override: Optional[float] = None) -> dict:
    parts = {
        "time": time_score(a, b), "name": name_score(a["name"], b["name"]),
        "format": format_score(a, b), "visual": visual_score(Path(a["lastFrame"]), Path(b["firstFrame"])),
        "text": (text_override, "continuidad del texto (IA)") if text_override is not None else text_score_heuristic(a, b),
    }
    total = sum(GROUP_WEIGHTS[k] * v[0] for k, v in parts.items())
    # Una fecha incompatible o una numeración inversa anulan el enlace
    if parts["time"][0] == 0.0 and a.get("creationTime") and b.get("creationTime"):
        total *= 0.3
    reasons = [v[1] for v in parts.values() if v[1]]
    return {"from": a["id"], "to": b["id"], "score": round(total, 3),
            "signals": {k: round(v[0], 2) for k, v in parts.items()}, "reasons": reasons}


def build_groups(clips: list[dict], use_ai: bool = False) -> tuple[list[list[str]], list[dict]]:
    """Encadena clips: A->B si B continúa A. Devuelve grupos ordenados y los enlaces elegidos."""
    by_id = {c["id"]: c for c in clips}
    pairs = [(a["id"], b["id"]) for a in clips for b in clips if a["id"] != b["id"]]
    ai_text: dict = {}
    if use_ai and pairs:
        try:
            ai_text = text_scores_claude(by_id, pairs)
        except Exception as e:  # noqa: BLE001 - la IA es opcional
            print("Continuidad con IA no disponible:", e)
    scored = [link_score(by_id[a], by_id[b], ai_text.get((a, b))) for a, b in pairs]
    scored.sort(key=lambda s: s["score"], reverse=True)
    nxt: dict[str, str] = {}
    prv: dict[str, str] = {}
    chosen = []

    def head(x):
        while x in prv:
            x = prv[x]
        return x

    for s in scored:
        if s["score"] < GROUP_LINK_THRESHOLD:
            break
        a, b = s["from"], s["to"]
        if a in nxt or b in prv or head(a) == b:
            continue
        nxt[a] = b
        prv[b] = a
        chosen.append(s)
    groups = []
    for c in clips:
        if c["id"] in prv:
            continue
        chain = [c["id"]]
        while chain[-1] in nxt:
            chain.append(nxt[chain[-1]])
        groups.append(chain)

    def group_key(g):
        first = by_id[g[0]]
        return (first.get("creationTime") or "9999", first["name"])

    groups.sort(key=group_key)
    return groups, chosen


# ====================================================================== flujo de importación
def import_dir(import_id: str) -> Path:
    p = (IMPORTS_DIR / import_id).resolve()
    if IMPORTS_DIR.resolve() not in p.parents:
        raise ValueError("importación no válida")
    return p


def load_import(import_id: str) -> dict:
    return json.loads((import_dir(import_id) / "import.json").read_text(encoding="utf-8"))


def save_import(import_id: str, data: dict):
    d = import_dir(import_id)
    tmp = d / "import.json.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, d / "import.json")


def new_import(name: str) -> str:
    import_id = new_id("imp")
    d = IMPORTS_DIR / import_id
    (d / "originales").mkdir(parents=True)
    save_import(import_id, {"id": import_id, "name": name, "createdAt": now_iso(), "clips": [],
                            "groups": [], "links": [], "status": "subiendo"})
    return import_id


def analyze_import(import_id: str, job, language: Optional[str] = "es", use_ai: bool = False,
                   proxy_codec: str = "h264"):
    """Analiza todos los clips subidos: metadatos, proxy, audio, fotogramas y transcripción."""
    d = import_dir(import_id)
    data = load_import(import_id)
    if proxy_codec not in PROXY_EXT:
        proxy_codec = "h264"
    if data.get("previewCodec") != proxy_codec:
        for c in data["clips"]:
            c.pop("proxy", None)
    data["previewCodec"] = proxy_codec
    clips = data["clips"]
    n = max(len(clips), 1)
    warnings = []
    for i, c in enumerate(clips):
        base = i / n
        step = 1 / n
        src = d / c["original"]
        job.update(base, f"Analizando {c['name']} ({i + 1}/{n})")
        if not c.get("duration"):
            c.update(probe(src))
        if not c.get("proxy"):
            job.update(message=f"Creando proxy de {c['name']}")
            ext = PROXY_EXT[proxy_codec]
            make_proxy(src, d / "proxies" / f"{c['id']}{ext}", c, d,
                       job.sub(base + step * 0.05, base + step * 0.45), job.cancel_event, proxy_codec)
            c["proxy"] = f"proxies/{c['id']}{ext}"
        wav = d / "audio" / f"{c['id']}.wav"
        if not wav.exists():
            extract_analysis_audio(src, wav, c, d, job.cancel_event)
        c["analysisAudio"] = f"audio/{c['id']}.wav"
        prx = d / c["proxy"]
        ff = d / "cache" / "frames" / f"{c['id']}_first.jpg"
        lf = d / "cache" / "frames" / f"{c['id']}_last.jpg"
        extract_frame(prx, 0.05, ff, d)
        extract_frame(prx, 0.25, lf, d, from_end=True)
        c["firstFrame"], c["lastFrame"] = str(ff), str(lf)
        c["thumbnail"] = f"cache/frames/{c['id']}_first.jpg"
        job.update(base + step * 0.5, f"Transcribiendo {c['name']}")
        if c["hasAudio"]:
            try:
                c["words"] = transcribe.transcribe(
                    wav, language, c["duration"], job.sub(base + step * 0.5, base + step),
                    cache=d / "cache" / "transcripts" / f"{c['id']}.json")
            except Exception as e:  # noqa: BLE001
                warnings.append(f"No se pudo transcribir {c['name']}: {e}")
                c["words"] = []
        else:
            c["words"] = []
        c["text"] = transcribe.words_to_text(c["words"])[:400]
        save_import(import_id, data)
    job.update(0.97, "Agrupando clips")
    groups, links = build_groups(clips, use_ai=use_ai)
    data["groups"] = groups
    data["links"] = links
    data["status"] = "analizado"
    data["warnings"] = warnings
    save_import(import_id, data)
    job.warnings = warnings
    return {"importId": import_id, "groups": groups}


def _link_or_copy(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def unique_project_name(base: str) -> str:
    base = slugify(base)
    name, i = base, 2
    while (PROJECTS_DIR / name).exists():
        name = f"{base}-{i}"
        i += 1
    return name


def create_projects(import_id: str, groups: list[list[str]], names: Optional[list[str]] = None) -> list[str]:
    """Crea un proyecto por grupo (vídeo). Los clips se enlazan (no se copian ni modifican)."""
    import project_ops
    d = import_dir(import_id)
    data = load_import(import_id)
    by_id = {c["id"]: c for c in data["clips"]}
    created = []
    for gi, group in enumerate(groups):
        group = [cid for cid in group if cid in by_id]
        if not group:
            continue
        label = (names[gi] if names and gi < len(names) and names[gi] else
                 data["name"] if len(groups) == 1 else f"{data['name']}-video-{gi + 1}")
        pname = unique_project_name(label)
        pdir = PROJECTS_DIR / pname
        sources = []
        transcript = []
        for cid in group:
            c = by_id[cid]
            ext = Path(c["original"]).suffix
            _link_or_copy(d / c["original"], pdir / "originales" / f"{cid}{ext}")
            _link_or_copy(d / c["proxy"], pdir / c["proxy"])
            _link_or_copy(d / c["analysisAudio"], pdir / "audio" / f"{cid}.wav")
            _link_or_copy(d / c["thumbnail"], pdir / "cache" / "frames" / f"{cid}_first.jpg")
            sources.append({
                "id": cid, "name": c["name"], "original": f"originales/{cid}{ext}",
                "proxy": c["proxy"], "duration": c["duration"], "width": c["width"],
                "height": c["height"], "fps": c["fps"], "rotation": c["rotation"],
                "hasAudio": c["hasAudio"], "videoCodec": c["videoCodec"], "audioCodec": c["audioCodec"],
                "creationTime": c.get("creationTime"), "device": c.get("device"),
            })
            transcript += [{"sourceId": cid, **w} for w in c.get("words", [])]
        project_ops.create_project(pname, sources, transcript, data.get("previewCodec", "h264"))
        created.append(pname)
    data["status"] = "confirmado"
    data["projects"] = created
    save_import(import_id, data)
    return created
