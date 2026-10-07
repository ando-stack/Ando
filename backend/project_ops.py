"""Operaciones sobre project.json: creación, carga/guardado y edición de la línea de tiempo.

Las mismas reglas de "ripple" (borrar un tramo desplaza todo lo posterior) están replicadas
en frontend/src/state/timelineOps.ts para la edición manual.
"""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Optional

import schema
from config import PROJECTS_DIR
from utils import new_id, now_iso, project_dir

OVERLAY_KEYS = ("texts", "emojis", "zooms")


# ====================================================================== persistencia
def project_file(name: str) -> Path:
    return project_dir(name) / "project.json"


def load(name: str) -> schema.Project:
    return schema.load(project_file(name))


def load_dict(name: str) -> dict:
    return load(name).model_dump(mode="json")


def save(name: str, data: dict | schema.Project) -> schema.Project:
    return schema.save(data, project_file(name))


def list_projects() -> list[dict]:
    out = []
    if not PROJECTS_DIR.exists():
        return out
    for p in sorted(PROJECTS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        f = p / "project.json"
        if p.name.startswith("_") or not f.exists():
            continue
        try:
            proj = schema.load(f)
            thumb = f"cache/frames/{proj.sources[0].id}_first.jpg" if proj.sources else None
            out.append({"name": p.name, "updatedAt": proj.updatedAt, "duration": round(proj.duration(), 2),
                        "clips": len(proj.sources), "thumbnail": thumb})
        except Exception as e:  # noqa: BLE001
            out.append({"name": p.name, "error": str(e)})
    return out


def create_project(name: str, sources: list[dict], transcript: list[dict], preview_codec: str = "h264") -> schema.Project:
    first = sources[0]
    vertical = first["height"] > first["width"]
    fps = min(60.0, round(max(s["fps"] for s in sources)))
    canvas = {"width": 1080, "height": 1920, "fps": fps, "aspect": "9:16"} if vertical else \
             {"width": 1920, "height": 1080, "fps": fps, "aspect": "16:9"}
    segments = [{"id": new_id("seg"), "sourceId": s["id"], "inPoint": 0.0, "outPoint": s["duration"]}
                for s in sources]
    t = 0.0
    cuts = []
    for s in sources[:-1]:
        t += s["duration"]
        cuts.append({"at": round(t, 3), "reason": "unión de clips"})
    data = {"name": name, "createdAt": now_iso(), "updatedAt": now_iso(), "canvas": canvas,
            "sources": sources, "segments": segments, "transcript": transcript, "cuts": cuts,
            "previewCodec": preview_codec}
    return save(name, data)


# ====================================================================== tiempo
def segment_spans(p: dict) -> list[tuple[dict, float, float]]:
    """[(segmento, inicio_salida, fin_salida)]"""
    out, t = [], 0.0
    for s in p["segments"]:
        d = s["outPoint"] - s["inPoint"]
        out.append((s, t, t + d))
        t += d
    return out


def duration(p: dict) -> float:
    return sum(s["outPoint"] - s["inPoint"] for s in p["segments"])


def source_to_output(p: dict, source_id: str, t: float) -> Optional[float]:
    for seg, a, _b in segment_spans(p):
        if seg["sourceId"] == source_id and seg["inPoint"] - 1e-6 <= t <= seg["outPoint"] + 1e-6:
            return a + (t - seg["inPoint"])
    return None


def output_to_source(p: dict, t: float) -> Optional[tuple[dict, float]]:
    spans = segment_spans(p)
    for seg, a, b in spans:
        if a <= t < b:
            return seg, seg["inPoint"] + (t - a)
    if spans and abs(t - spans[-1][2]) < 1e-3:
        seg = spans[-1][0]
        return seg, seg["outPoint"]
    return None


def source_range_to_output(p: dict, source_id: str, start: float, end: float) -> list[tuple[float, float]]:
    """Proyecta un tramo del clip fuente sobre la salida (puede quedar partido por cortes)."""
    out = []
    for seg, a, _b in segment_spans(p):
        if seg["sourceId"] != source_id:
            continue
        s, e = max(start, seg["inPoint"]), min(end, seg["outPoint"])
        if e > s:
            out.append((a + s - seg["inPoint"], a + e - seg["inPoint"]))
    return out


def output_words(p: dict) -> list[dict]:
    """Transcripción proyectada a tiempo de salida (solo palabras que siguen en el montaje)."""
    words = []
    for w in p.get("transcript", []):
        mid = (w["start"] + w["end"]) / 2
        t = source_to_output(p, w["sourceId"], mid)
        if t is None:
            continue
        s = source_to_output(p, w["sourceId"], w["start"])
        e = source_to_output(p, w["sourceId"], w["end"])
        s = t - (mid - w["start"]) if s is None else s
        e = t + (w["end"] - mid) if e is None else e
        words.append({"text": w["text"], "start": round(max(0, s), 3), "end": round(max(s + 0.02, e), 3),
                      "sourceId": w["sourceId"], "srcStart": w["start"]})
    words.sort(key=lambda w: w["start"])
    return words


def find_phrase(p: dict, phrase: str) -> list[dict]:
    """Busca un texto en la transcripción (tiempo de salida). Ignora mayúsculas y acentos."""
    import unicodedata

    def norm(s):
        s = unicodedata.normalize("NFD", s.lower())
        return "".join(c for c in s if c.isalnum() or c == " ")

    words = output_words(p)
    target = norm(phrase).split()
    if not target:
        return []
    toks = [norm(w["text"]).strip() for w in words]
    hits = []
    for i in range(len(toks) - len(target) + 1):
        if all(toks[i + j] == target[j] for j in range(len(target))):
            hits.append({"start": words[i]["start"], "end": words[i + len(target) - 1]["end"],
                         "text": " ".join(w["text"] for w in words[i:i + len(target)])})
    return hits


# ====================================================================== ripple
def _shift_items(items: list[dict], start: float, end: float) -> list[dict]:
    d = end - start
    out = []
    for it in items:
        s, e = it["start"], it["end"]
        if e <= start:
            out.append(it)
        elif s >= end:
            it["start"], it["end"] = round(s - d, 3), round(e - d, 3)
            out.append(it)
        elif s >= start and e <= end:
            continue  # dentro del tramo borrado
        else:
            ns = s if s < start else start
            ne = e - d if e > end else start
            if ne - ns >= 0.1:
                it["start"], it["end"] = round(ns, 3), round(ne, 3)
                if "words" in it:
                    it["words"] = _shift_words(it["words"], start, end)
                    if not it["words"]:
                        continue
                out.append(it)
    return out


def _shift_words(words: list[dict], start: float, end: float) -> list[dict]:
    d = end - start
    out = []
    for w in words:
        if w["end"] <= start:
            out.append(w)
        elif w["start"] >= end:
            out.append({**w, "start": round(w["start"] - d, 3), "end": round(w["end"] - d, 3)})
    return out


def _shift_points(items: list[dict], key: str, start: float, end: float) -> list[dict]:
    d = end - start
    out = []
    for it in items:
        t = it[key]
        if t < start:
            out.append(it)
        elif t >= end:
            it[key] = round(t - d, 3)
            out.append(it)
        elif abs(t - start) < 1e-6:
            out.append(it)
    return out


def ripple_delete(p: dict, start: float, end: float, reason: str = "tramo eliminado") -> dict:
    """Elimina el tramo [start, end) del vídeo final y desplaza todo lo posterior."""
    p = copy.deepcopy(p)
    total = duration(p)
    start, end = max(0.0, start), min(end, total)
    if end - start < 0.02:
        return p
    new_segments = []
    for seg, a, b in segment_spans(p):
        if b <= start or a >= end:
            new_segments.append(seg)
            continue
        if a < start:  # parte izquierda
            left = {**seg, "outPoint": round(seg["inPoint"] + (start - a), 3)}
            if left["outPoint"] - left["inPoint"] >= 0.04:
                new_segments.append(left)
        if b > end:  # parte derecha
            right = {**seg, "id": new_id("seg") if a < start else seg["id"],
                     "inPoint": round(seg["inPoint"] + (end - a), 3)}
            if right["outPoint"] - right["inPoint"] >= 0.04:
                new_segments.append(right)
    p["segments"] = new_segments
    for k in OVERLAY_KEYS:
        p[k] = _shift_items(p[k], start, end)
    p["captions"]["blocks"] = _shift_items(p["captions"]["blocks"], start, end)
    p["faces"]["pixelate"] = _shift_items(p["faces"]["pixelate"], start, end)
    p["transitions"] = _shift_points(p["transitions"], "at", start, end)
    p["audio"]["sfx"] = _shift_points(p["audio"]["sfx"], "at", start, end)
    p["cuts"] = _shift_points(p["cuts"], "at", start, end)
    p["cuts"].append({"at": round(start, 3), "reason": reason})
    p["cuts"].sort(key=lambda c: c["at"])
    sp = []
    for a, b in p["audio"].get("speech", []):
        for it in _shift_items([{"start": a, "end": b}], start, end):
            sp.append([it["start"], it["end"]])
    p["audio"]["speech"] = sp
    m = p["audio"].get("music")
    if m and m.get("end") is not None:
        m["end"] = round(m["end"] - (end - start) if m["end"] > end else min(m["end"], start), 3)
        if m["end"] <= m["start"] + 0.1:
            m["end"] = None
    return p


def split_at(p: dict, t: float) -> dict:
    """Divide el segmento de vídeo que contiene el instante t (tiempo de salida)."""
    p = copy.deepcopy(p)
    out = []
    for seg, a, b in segment_spans(p):
        if a + 0.04 < t < b - 0.04:
            cut = round(seg["inPoint"] + (t - a), 3)
            out.append({**seg, "outPoint": cut})
            out.append({**seg, "id": new_id("seg"), "inPoint": cut})
            p["cuts"].append({"at": round(t, 3), "reason": "división manual"})
        else:
            out.append(seg)
    p["segments"] = out
    return p
