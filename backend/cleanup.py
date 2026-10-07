"""Limpieza: silencios, muletillas, repeticiones y tomas falsas (en tiempo de cada clip fuente)."""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from config import FILLER_ALWAYS, FILLER_WORDS
from utils import FFmpegError, write_log


# ====================================================================== silencios
def detect_silences(wav: Path, threshold_db: float, min_dur: float, proj_dir: Optional[Path] = None) -> list[tuple[float, float]]:
    import subprocess
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af",
           f"silencedetect=noise={threshold_db}dB:d={min_dur}", "-f", "null", "-"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log = write_log(proj_dir, "deteccion de silencios", cmd, proc.stderr)
        raise FFmpegError(f"Falló la detección de silencios (detalles en {log})", log)
    silences, start = [], None
    for line in proc.stderr.splitlines():
        m = re.search(r"silence_start: (-?[\d.]+)", line)
        if m:
            start = max(0.0, float(m.group(1)))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and start is not None:
            silences.append((start, float(m.group(1))))
            start = None
    if start is not None:
        silences.append((start, float("inf")))
    return silences


# ====================================================================== utilidades de intervalos
def merge(ranges: list[tuple[float, float]], gap: float = 0.0) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def subtract(keep: list[tuple[float, float]], remove: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out = keep
    for ra, rb in merge(remove):
        nxt = []
        for a, b in out:
            if rb <= a or ra >= b:
                nxt.append((a, b))
                continue
            if ra > a:
                nxt.append((a, ra))
            if rb < b:
                nxt.append((rb, b))
        out = nxt
    return out


def norm_word(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if c.isalnum() or c == " ").strip()


# ====================================================================== silencios -> tramos a quitar
def silence_removals(silences, words, duration, min_silence, padding):
    """Convierte silencios en tramos a eliminar dejando un margen para que el corte no sea brusco.
    Nunca corta dentro de una palabra transcrita."""
    rem = []
    for a, b in silences:
        b = min(b, duration)
        if b - a < min_silence:
            continue
        ra = a + padding if a > 0.01 else 0.0           # al principio del clip se quita todo
        rb = b - padding if b < duration - 0.01 else duration
        for w in words:  # no invadir palabras
            if w["start"] < rb and w["end"] > ra:
                if w["start"] <= ra:
                    ra = max(ra, w["end"] + 0.05)
                else:
                    rb = min(rb, w["start"] - 0.05)
        if rb - ra >= 0.15:
            rem.append((round(ra, 3), round(rb, 3)))
    # pausas largas entre palabras que silencedetect no captó (p. ej. ruido de fondo)
    for w1, w2 in zip(words, words[1:]):
        gap = w2["start"] - w1["end"]
        if gap >= min_silence * 1.6:
            ra, rb = w1["end"] + padding, w2["start"] - padding
            if rb - ra >= 0.15:
                rem.append((round(ra, 3), round(rb, 3)))
    return merge(rem)


# ====================================================================== muletillas
def filler_removals(words: list[dict]) -> list[dict]:
    """Muletillas: las 'fuertes' (eh, em, mmm) siempre; las de palabra normal solo si van aisladas."""
    out = []
    multi = [f for f in FILLER_WORDS if " " in f]
    for i, w in enumerate(words):
        t = norm_word(w["text"])
        prev_gap = w["start"] - words[i - 1]["end"] if i > 0 else 1.0
        next_gap = words[i + 1]["start"] - w["end"] if i + 1 < len(words) else 1.0
        isolated = prev_gap > 0.25 and next_gap > 0.25
        if t in FILLER_ALWAYS or (t in FILLER_WORDS and isolated):
            out.append({"start": w["start"], "end": w["end"], "text": w["text"], "reason": "muletilla"})
        elif i + 1 < len(words):
            pair = f"{t} {norm_word(words[i + 1]['text'])}"
            if pair in multi and isolated:
                out.append({"start": w["start"], "end": words[i + 1]["end"], "text": pair, "reason": "muletilla"})
    return out


# ====================================================================== tomas falsas
def phrases(words: list[dict], pause: float = 0.35) -> list[dict]:
    """Agrupa palabras en frases por puntuación o pausas."""
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        end_punct = bool(re.search(r"[.!?…]$", w["text"]))
        gap = words[i + 1]["start"] - w["end"] if i + 1 < len(words) else 9
        if end_punct or gap > pause:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"words": p, "start": p[0]["start"], "end": p[-1]["end"],
             "text": " ".join(x["text"] for x in p), "norm": [norm_word(x["text"]) for x in p]} for p in out]


def retake_removals(words: list[dict]) -> list[dict]:
    """Si una frase se repite (la primera vez incompleta o con error), se queda la última."""
    ph = phrases(words)
    out = []
    for i, p in enumerate(ph):
        a = [x for x in p["norm"] if x]
        if len(a) < 2:
            continue
        for q in ph[i + 1:i + 4]:
            b = [x for x in q["norm"] if x]
            if len(b) < 2:
                continue
            head = b[:len(a)]
            ratio = SequenceMatcher(None, a, head).ratio()
            if ratio >= 0.75 and len(b) >= len(a) * 0.8:
                out.append({"start": p["start"], "end": q["start"] - 0.05, "text": p["text"],
                            "reason": "toma repetida"})
                break
    return out


# ====================================================================== plan de cortes
def plan_source(words, silences, duration, settings, extra_removals=None) -> tuple[list[tuple[float, float]], list[dict]]:
    """Devuelve los tramos a conservar de un clip y la lista de cortes (para marcas en la timeline)."""
    removals: list[dict] = []
    if settings.get("silences", True):
        for a, b in silence_removals(silences, words, duration, settings["minSilence"], settings["silencePadding"]):
            removals.append({"start": a, "end": b, "reason": "silencio"})
    if settings.get("fillers", True):
        removals += filler_removals(words)
    if settings.get("retakes", True):
        removals += retake_removals(words)
    removals += extra_removals or []
    keep = subtract([(0.0, duration)], [(r["start"], r["end"]) for r in removals])
    keep = [(round(a, 3), round(b, 3)) for a, b in keep if b - a >= 0.2]
    # unir tramos separados por cortes minúsculos (< 80 ms) para evitar saltos
    keep = merge(keep, gap=0.08)
    return keep, sorted(removals, key=lambda r: r["start"])
