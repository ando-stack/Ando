"""Fase 4: detección, seguimiento e identificación de caras, y verificación del pixelado.

Nunca se pixela nada automáticamente: este módulo solo analiza. El pixelado se dibuja en la
composición de Remotion (previsualización y render) a partir de las muestras de cada cara.
Ninguna imagen de cara sale del ordenador.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from config import (ASSETS_DIR, FACE_MAX_GAP, FACE_MIN_CONFIDENCE, FACE_SAMPLE_FPS,
                    FACE_UNRELIABLE_GAP)
from utils import Cancelled

MODELS = ASSETS_DIR / "models"
ANALYSIS_WIDTH = 640
_det_lock = threading.Lock()


# ====================================================================== detector
class Detector:
    """MediaPipe (BlazeFace) + OpenCV YuNet; se fusionan para cubrir caras pequeñas y giros."""

    def __init__(self):
        self.mp = None
        self.yunet = None
        try:
            from mediapipe.tasks.python import BaseOptions, vision
            opts = vision.FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=str(MODELS / "blaze_face_short_range.tflite")),
                min_detection_confidence=FACE_MIN_CONFIDENCE)
            self.mp = vision.FaceDetector.create_from_options(opts)
        except Exception as e:  # noqa: BLE001
            print("MediaPipe no disponible:", e)
        yn = MODELS / "face_detection_yunet_2023mar.onnx"
        if yn.exists():
            try:
                self.yunet = cv2.FaceDetectorYN.create(str(yn), "", (320, 320), 0.6, 0.3, 50)
            except Exception as e:  # noqa: BLE001
                print("YuNet no disponible:", e)
        if not self.mp and not self.yunet:
            raise RuntimeError("No hay ningún detector de caras disponible (MediaPipe o YuNet)")

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        h, w = rgb.shape[:2]
        dets = []
        if self.mp:
            import mediapipe as mp
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            with _det_lock:
                res = self.mp.detect(img)
            for d in res.detections:
                b = d.bounding_box
                score = d.categories[0].score if d.categories else 0.5
                if score < 0.75:  # el modelo de corto alcance da falsos positivos con puntuación baja
                    continue
                dets.append((b.origin_x / w, b.origin_y / h, b.width / w, b.height / h, float(score)))
        if self.yunet:
            with _det_lock:
                self.yunet.setInputSize((w, h))
                _, faces = self.yunet.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
            if faces is not None:
                for f in faces:
                    dets.append((f[0] / w, f[1] / h, f[2] / w, f[3] / h, float(f[-1])))
        return nms(dets)


def iou(a, b) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def nms(dets, thr=0.3):
    dets = sorted(dets, key=lambda d: d[4], reverse=True)
    keep = []
    for d in dets:
        if d[2] <= 0 or d[3] <= 0:
            continue
        match = next((k for k in keep if iou(k, d) > thr), None)
        if match is None:
            keep.append(d)
        else:  # fusionar: caja unión para cubrir mejor
            i = keep.index(match)
            x1, y1 = min(match[0], d[0]), min(match[1], d[1])
            x2, y2 = max(match[0] + match[2], d[0] + d[2]), max(match[1] + match[3], d[1] + d[3])
            keep[i] = (x1, y1, x2 - x1, y2 - y1, max(match[4], d[4]))
    return keep


_detector: Optional[Detector] = None


def get_detector() -> Detector:
    global _detector
    if _detector is None:
        _detector = Detector()
    return _detector


# ====================================================================== lectura de fotogramas
def iter_frames(video: Path, fps: float, width: int = ANALYSIS_WIDTH, cancel=None):
    """Genera (t, rgb) muestreando el vídeo a `fps` fotogramas por segundo."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height", "-of", "csv=p=0", str(video)], capture_output=True, text=True)
    vw, vh = [int(x) for x in probe.stdout.strip().split(",")[:2]]
    height = int(round(vh * width / vw / 2) * 2)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps},scale={width}:{height}",
                             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = width * height * 3
    i = 0
    try:
        while True:
            if cancel is not None and cancel.is_set():
                raise Cancelled()
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield (i + 0.5) / fps, np.frombuffer(buf, np.uint8).reshape(height, width, 3)
            i += 1
    finally:
        proc.kill()
        proc.wait()


def grab_frame(video: Path, t: float, width: int = ANALYSIS_WIDTH) -> Optional[np.ndarray]:
    proc = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.3f}", "-i", str(video), "-frames:v", "1",
                           "-vf", f"scale={width}:-2", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return None
    img = cv2.imdecode(np.frombuffer(proc.stdout, np.uint8), cv2.IMREAD_COLOR)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB) if img is not None else None


# ====================================================================== seguimiento
def track_source(video: Path, duration: float, detector: Detector, progress=None, cancel=None) -> list[dict]:
    tracks: list[dict] = []
    max_lost = 1.5
    for t, rgb in iter_frames(video, FACE_SAMPLE_FPS, cancel=cancel):
        if progress:
            progress(min(1.0, t / max(duration, 0.1)))
        dets = detector.detect(rgb)
        active = [tr for tr in tracks if t - tr["last_t"] <= max_lost]
        pairs = []
        for di, d in enumerate(dets):
            for tr in active:
                lb = tr["last_box"]
                cdist = np.hypot((d[0] + d[2] / 2) - (lb[0] + lb[2] / 2), (d[1] + d[3] / 2) - (lb[1] + lb[3] / 2))
                size = max(lb[2], lb[3], d[2], d[3])
                score = iou(d, lb) + max(0.0, 1 - cdist / (size * 1.5 + 1e-6)) * 0.5
                if score > 0.15:
                    pairs.append((score, di, tr))
        pairs.sort(key=lambda x: x[0], reverse=True)
        used_d, used_t = set(), set()
        for score, di, tr in pairs:
            if di in used_d or id(tr) in used_t:
                continue
            used_d.add(di)
            used_t.add(id(tr))
            d = dets[di]
            tr["samples"].append({"t": t, "box": d[:4], "score": d[4]})
            tr["last_t"], tr["last_box"] = t, d[:4]
            if d[4] > tr["best"][0] and d[2] * d[3] > 0.002:
                tr["best"] = (d[4] * (d[2] * d[3]) ** 0.25, t, d[:4], crop(rgb, d[:4]))
        for di, d in enumerate(dets):
            if di not in used_d:
                tracks.append({"samples": [{"t": t, "box": d[:4], "score": d[4]}], "last_t": t, "last_box": d[:4],
                               "best": (d[4] * (d[2] * d[3]) ** 0.25, t, d[:4], crop(rgb, d[:4])), "feats": []})
        for tr in tracks:
            if tr["last_t"] == t and len(tr["feats"]) < 8 and len(tr["samples"]) % 3 == 1:
                tr["feats"].append(face_feature(rgb, tr["last_box"]))
    # descartar falsos positivos muy breves
    return [tr for tr in tracks if len(tr["samples"]) >= 3]


def crop(rgb, box, pad=0.25):
    h, w = rgb.shape[:2]
    x, y, bw, bh = box
    x1, y1 = int(max(0, (x - bw * pad) * w)), int(max(0, (y - bh * pad) * h))
    x2, y2 = int(min(w, (x + bw * (1 + pad)) * w)), int(min(h, (y + bh * (1 + pad)) * h))
    return rgb[y1:y2, x1:x2].copy() if x2 > x1 and y2 > y1 else None


def face_feature(rgb, box) -> Optional[np.ndarray]:
    c = crop(rgb, box, pad=0.0)
    if c is None or c.size == 0:
        return None
    g = cv2.resize(cv2.cvtColor(c, cv2.COLOR_RGB2GRAY), (24, 24)).astype(np.float32).ravel()
    g = (g - g.mean()) / (g.std() + 1e-6)
    hsv = cv2.cvtColor(cv2.resize(c, (32, 32)), cv2.COLOR_RGB2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [12, 6], [0, 180, 0, 256]).ravel()
    hist = hist / (np.linalg.norm(hist) + 1e-6)
    return np.concatenate([g / np.sqrt(len(g)), hist])


def smooth_and_fill(samples: list[dict]) -> tuple[list[dict], list[tuple[float, float]]]:
    """Rellena huecos interpolando, suaviza (media móvil) y devuelve los tramos poco fiables."""
    samples = sorted(samples, key=lambda s: s["t"])
    step = 1.0 / FACE_SAMPLE_FPS
    out, unreliable = [], []
    for a, b in zip(samples, samples[1:] + [None]):
        out.append({**a, "interpolated": False})
        if b is None:
            continue
        gap = b["t"] - a["t"]
        if gap > step * 1.5:
            if gap > FACE_UNRELIABLE_GAP:
                unreliable.append((a["t"], b["t"]))
            n = int(round(gap / step)) - 1
            for k in range(1, n + 1):
                f = k / (n + 1)
                box = tuple(a["box"][i] * (1 - f) + b["box"][i] * f for i in range(4))
                out.append({"t": a["t"] + gap * f, "box": box, "score": 0.0, "interpolated": True})
        if a["score"] and a["score"] < FACE_MIN_CONFIDENCE + 0.1:
            unreliable.append((a["t"] - step / 2, a["t"] + step / 2))
    # media móvil sobre centro y tamaño (5 muestras) para que no "salte"
    arr = np.array([[s["box"][0] + s["box"][2] / 2, s["box"][1] + s["box"][3] / 2, s["box"][2], s["box"][3]]
                    for s in out], np.float32)
    if len(arr) >= 3:
        k = 5 if len(arr) >= 5 else 3
        pad = np.pad(arr, ((k // 2, k // 2), (0, 0)), mode="edge")
        kern = np.ones(k) / k
        sm = np.stack([np.convolve(pad[:, i], kern, mode="valid") for i in range(4)], 1)
        # el tamaño nunca menor que el detectado (mejor cubrir de más)
        sm[:, 2] = np.maximum(sm[:, 2], arr[:, 2])
        sm[:, 3] = np.maximum(sm[:, 3], arr[:, 3])
        arr = sm
    res = []
    for s, (cx, cy, w, h) in zip(out, arr):
        res.append({"t": round(float(s["t"]), 3), "x": round(float(cx - w / 2), 4), "y": round(float(cy - h / 2), 4),
                    "w": round(float(w), 4), "h": round(float(h), 4), "interpolated": s["interpolated"]})
    # prolongar un poco al principio y al final por seguridad
    if res:
        res.insert(0, {**res[0], "t": round(max(0.0, res[0]["t"] - 0.15), 3), "interpolated": True})
        res.append({**res[-1], "t": round(res[-1]["t"] + 0.15, 3), "interpolated": True})
    merged = []
    for a, b in sorted(unreliable):
        if merged and a <= merged[-1][1] + 0.2:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return res, merged


# ====================================================================== flujo completo
def analyze_project(proj_dir: Path, p: dict, job=None) -> dict:
    det = get_detector()
    all_tracks = []
    n = len(p["sources"])
    for i, s in enumerate(p["sources"]):
        if job:
            job.update(i / n, f"Buscando caras en {s['name']}")
        trs = track_source(proj_dir / s["proxy"], s["duration"], det,
                           job.sub(i / n, (i + 1) / n) if job else None, job.cancel_event if job else None)
        for tr in trs:
            tr["sourceId"] = s["id"]
        all_tracks += trs
    # identidad: unir tramos parecidos que no coinciden en el tiempo (misma persona)
    parent = list(range(len(all_tracks)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def overlap(a, b):
        if a["sourceId"] != b["sourceId"]:
            return False
        return not (a["samples"][-1]["t"] < b["samples"][0]["t"] or b["samples"][-1]["t"] < a["samples"][0]["t"])

    feats = []
    for tr in all_tracks:
        f = [x for x in tr["feats"] if x is not None]
        feats.append(np.mean(f, 0) if f else None)
    for i in range(len(all_tracks)):
        for j in range(i + 1, len(all_tracks)):
            if feats[i] is None or feats[j] is None or overlap(all_tracks[i], all_tracks[j]):
                continue
            sim = float(np.dot(feats[i], feats[j]) / (np.linalg.norm(feats[i]) * np.linalg.norm(feats[j]) + 1e-6))
            if sim > 0.86:
                parent[find(j)] = find(i)
    groups: dict[int, list[dict]] = {}
    for i, tr in enumerate(all_tracks):
        groups.setdefault(find(i), []).append(tr)
    faces_dir = proj_dir / "cache" / "faces"
    faces_dir.mkdir(parents=True, exist_ok=True)
    tracks_out, unreliable = [], []
    order = sorted(groups.values(), key=lambda g: -sum(len(t["samples"]) for t in g))
    for k, g in enumerate(order):
        fid = f"cara-{k + 1}"
        best = max(g, key=lambda t: t["best"][0])["best"]
        thumb = None
        if best[3] is not None and best[3].size:
            thumb = f"cache/faces/{fid}.jpg"
            cv2.imwrite(str(proj_dir / thumb), cv2.cvtColor(cv2.resize(best[3], (128, int(128 * best[3].shape[0] / max(best[3].shape[1], 1)))), cv2.COLOR_RGB2BGR))
        parts: dict[str, list] = {}
        for tr in sorted(g, key=lambda t: t["samples"][0]["t"]):
            samples, unrel = smooth_and_fill(tr["samples"])
            parts.setdefault(tr["sourceId"], []).extend(samples)
            unreliable += [{"sourceId": tr["sourceId"], "start": round(a, 3), "end": round(b, 3)} for a, b in unrel]
        tracks_out.append({"id": fid, "label": f"Persona {k + 1}", "thumbnail": thumb,
                           "parts": [{"sourceId": sid, "samples": sorted(sm, key=lambda x: x["t"])}
                                     for sid, sm in parts.items()]})
    p["faces"]["tracks"] = tracks_out
    p["faces"]["unreliable"] = unreliable
    p["faces"]["analyzed"] = True
    face_ids = {t["id"] for t in tracks_out}
    p["faces"]["pixelate"] = [x for x in p["faces"]["pixelate"] if x["faceId"] in face_ids]
    return p


# ====================================================================== geometría compartida con Remotion
def box_at(samples: list[dict], t: float) -> Optional[tuple[float, float, float, float]]:
    """Caja interpolada en el instante t (igual que en frontend/src/remotion/faces.ts)."""
    if not samples or t < samples[0]["t"] - 0.05 or t > samples[-1]["t"] + 0.05:
        return None
    lo, hi = 0, len(samples) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if samples[mid]["t"] <= t:
            lo = mid
        else:
            hi = mid
    a, b = samples[lo], samples[hi]
    f = 0.0 if b["t"] == a["t"] else min(1.0, max(0.0, (t - a["t"]) / (b["t"] - a["t"])))
    return tuple(a[k] * (1 - f) + b[k] * f for k in ("x", "y", "w", "h"))


def expand(box, margin):
    x, y, w, h = box
    nw, nh = w * (1 + margin), h * (1 + margin)
    return (x - (nw - w) / 2, y - (nh - h) / 2, nw, nh)


def pixelate_region(rgb: np.ndarray, box, mode: str, intensity: float) -> np.ndarray:
    """Misma fórmula que la composición: bloques = max(3, round(18 - 14*intensidad))."""
    h, w = rgb.shape[:2]
    x, y, bw, bh = box
    x1, y1 = int(max(0, x * w)), int(max(0, y * h))
    x2, y2 = int(min(w, (x + bw) * w)), int(min(h, (y + bh) * h))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return rgb
    out = rgb.copy()
    reg = out[y1:y2, x1:x2]
    if mode == "blur":
        r = max(1, int((bw * w) * (0.05 + 0.25 * intensity)))
        k = r * 2 + 1
        out[y1:y2, x1:x2] = cv2.GaussianBlur(reg, (k, k), r / 2 + 1)
    else:
        blocks = max(3, round(18 - 14 * intensity))
        bx = blocks
        by = max(2, round(blocks * (y2 - y1) / max(x2 - x1, 1)))
        small = cv2.resize(reg, (bx, by), interpolation=cv2.INTER_AREA)
        out[y1:y2, x1:x2] = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
    return out


def verify(proj_dir: Path, p: dict, max_frames: int = 12) -> list[dict]:
    """Comprueba en varios fotogramas que la cara queda cubierta tras pixelar.

    Para cada fotograma: (1) la caja detectada en el original debe quedar dentro de la zona
    pixelada, y (2) el detector no debe encontrar una cara en la zona tras pixelar."""
    import project_ops
    det = get_detector()
    tracks = {t["id"]: t for t in p["faces"]["tracks"]}
    results = []
    sheet = []
    items = p["faces"]["pixelate"]
    if not items:
        return []
    per_item = max(2, max_frames // len(items))
    for it in items:
        tr = tracks.get(it["faceId"])
        if not tr:
            continue
        for k in range(per_item):
            t_out = it["start"] + (it["end"] - it["start"]) * (k + 0.5) / per_item
            loc = project_ops.output_to_source(p, t_out)
            if not loc:
                continue
            seg, ts = loc
            part = next((pt for pt in tr["parts"] if pt["sourceId"] == seg["sourceId"]), None)
            src = next(s for s in p["sources"] if s["id"] == seg["sourceId"])
            box = box_at(part["samples"], ts) if part else None
            rgb = grab_frame(proj_dir / src["proxy"], ts)
            if rgb is None:
                continue
            entry = {"itemId": it["id"], "faceId": it["faceId"], "time": round(t_out, 2), "ok": True, "note": ""}
            if box is None:
                entry.update(ok=None, note="la cara no aparece en este momento")
                results.append(entry)
                continue
            pbox = expand(box, it["margin"])
            dets = det.detect(rgb)
            near = [d for d in dets if iou(d, box) > 0.1]
            for d in near:
                ix = max(0, min(d[0] + d[2], pbox[0] + pbox[2]) - max(d[0], pbox[0]))
                iy = max(0, min(d[1] + d[3], pbox[1] + pbox[3]) - max(d[1], pbox[1]))
                cover = ix * iy / max(d[2] * d[3], 1e-6)
                if cover < 0.9:
                    entry.update(ok=False, note=f"la cara solo queda cubierta al {cover * 100:.0f} %")
            after = pixelate_region(rgb, pbox, it["mode"], it["intensity"])
            still = [d for d in det.detect(after) if iou(d, box) > 0.2 and d[4] > 0.7]
            if still and entry["ok"]:
                entry.update(ok=False, note="la cara sigue siendo reconocible: sube la intensidad")
            if entry["ok"] and not near:
                entry["note"] = "cubierta (zona seguida por interpolación)"
            elif entry["ok"]:
                entry["note"] = "cubierta"
            results.append(entry)
            vis = after.copy()
            col = (40, 200, 60) if entry["ok"] else (230, 40, 40)
            h, w = vis.shape[:2]
            cv2.rectangle(vis, (int(pbox[0] * w), int(pbox[1] * h)), (int((pbox[0] + pbox[2]) * w), int((pbox[1] + pbox[3]) * h)), col, 2)
            sheet.append(cv2.resize(vis, (320, int(320 * h / w))))
    if sheet:
        rows = [np.concatenate(sheet[i:i + 4] + [np.zeros_like(sheet[0])] * (4 - len(sheet[i:i + 4])), 1)
                for i in range(0, len(sheet), 4)]
        out = proj_dir / "cache" / "faces" / "verificacion.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out), cv2.cvtColor(np.concatenate(rows, 0), cv2.COLOR_RGB2BGR))
    return results


def default_pixelate_items(p: dict, face_id: str, mode="pixelate", intensity=0.75, margin=0.35) -> list[dict]:
    """Tramos de salida en los que aparece la cara (uno por tramo continuo)."""
    import project_ops
    from utils import new_id
    tr = next((t for t in p["faces"]["tracks"] if t["id"] == face_id), None)
    if not tr:
        return []
    ranges = []
    for part in tr["parts"]:
        if not part["samples"]:
            continue
        a, b = part["samples"][0]["t"], part["samples"][-1]["t"]
        ranges += project_ops.source_range_to_output(p, part["sourceId"], a, b)
    merged = []
    for a, b in sorted(ranges):
        if merged and a <= merged[-1][1] + 0.05:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return [{"id": new_id("pix"), "start": round(a, 3), "end": round(b, 3), "faceId": face_id, "mode": mode,
             "intensity": intensity, "margin": margin} for a, b in merged if b - a >= 0.05]
