"""Generación, puntuación y deduplicación de candidatos a clip.

La puntuación (0-100) es una ESTIMACIÓN DE INTERÉS basada en señales medibles, no una
probabilidad de viralidad. Cada candidato incluye puntuaciones parciales, categoría, confianza
y una explicación legible de por qué se eligió.

Se usa igual para vídeos importados (todo el archivo) y para directos (ventana del buffer).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .audio import AudioEvent, AudioFeatures, audio_quality, silence_points
from .semantic import CATEGORY_LABELS, SegmentScore, semantic_series, text_similarity
from .transcribe import Segment

DEFAULT_WEIGHTS: dict[str, float] = {
    "semantic": 0.22,
    "vocal": 0.20,
    "visual": 0.10,
    "context": 0.10,
    "chat": 0.12,
    "clarity": 0.08,
    "originality": 0.06,
    "audio_quality": 0.05,
    "resolution": 0.07,
}

COMPONENT_LABELS = {
    "semantic": "Interés semántico",
    "vocal": "Reacción vocal",
    "visual": "Impacto visual",
    "context": "Contexto",
    "chat": "Actividad del chat",
    "clarity": "Claridad",
    "originality": "Originalidad",
    "audio_quality": "Calidad de audio",
    "resolution": "Desenlace",
}

DURATION_PRESETS = {"15": 15.0, "30": 30.0, "45": 45.0, "60": 60.0}


@dataclass
class DetectionParams:
    duration_mode: str = "auto"  # auto | 15 | 30 | 45 | 60 | custom
    custom_duration: float | None = None
    min_duration: float = 12.0
    max_duration: float = 60.0
    sensitivity: float = 1.0
    max_candidates: int = 20
    min_score: float = 0.0
    categories: list[str] | None = None  # filtro opcional
    weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    min_gap: float = 20.0

    def target(self) -> float | None:
        if self.duration_mode in DURATION_PRESETS:
            return DURATION_PRESETS[self.duration_mode]
        if self.duration_mode == "custom" and self.custom_duration:
            return float(self.custom_duration)
        return None


@dataclass
class Signals:
    hop: float
    duration: float
    audio: AudioFeatures
    audio_events: list[AudioEvent] = field(default_factory=list)
    segments: list[Segment] = field(default_factory=list)
    seg_scores: list[SegmentScore] = field(default_factory=list)
    visual: np.ndarray | None = None
    scene_cuts: list[float] = field(default_factory=list)
    chat: np.ndarray | None = None
    chat_raw: dict | None = None
    time_offset: float = 0.0  # para directos: segundo absoluto del inicio de la ventana


@dataclass
class Candidate:
    start: float
    end: float
    peak: float
    score: float
    scores: dict[str, float]
    category: str
    confidence: float
    explanation: str
    reasons: list[str]
    text: str

    @property
    def duration(self) -> float:
        return self.end - self.start


def _smooth(x: np.ndarray, seconds: float, hop: float) -> np.ndarray:
    k = max(1, int(seconds / hop))
    if k <= 1 or len(x) < k:
        return x
    return np.convolve(x, np.ones(k, dtype=np.float32) / k, mode="same")


def _fit(x: np.ndarray | None, n: int) -> np.ndarray | None:
    if x is None:
        return None
    if len(x) >= n:
        return x[:n].astype(np.float32)
    return np.pad(x.astype(np.float32), (0, n - len(x)))


def vocal_curve(sig: Signals) -> np.ndarray:
    a = sig.audio
    v = np.clip(a.z_energy / 5.0, 0, 1)
    for ev in sig.audio_events:
        if ev.type in ("laughter", "scream", "loud_reaction"):
            i0, i1 = int(ev.start / sig.hop), max(int(ev.start / sig.hop) + 1, int(ev.end / sig.hop))
            boost = ev.confidence * (1.0 if ev.type != "loud_reaction" else 0.9)
            v[i0:i1] = np.maximum(v[i0:i1], boost)
    return v.astype(np.float32)


def component_curves(sig: Signals) -> dict[str, np.ndarray]:
    n = sig.audio.n
    curves = {"vocal": vocal_curve(sig)}
    if sig.seg_scores:
        curves["semantic"] = semantic_series(sig.seg_scores, n, sig.hop)
    vis = _fit(sig.visual, n)
    if vis is not None and vis.any():
        curves["visual"] = vis
    chat = _fit(sig.chat, n)
    if chat is not None and chat.any():
        curves["chat"] = chat
    return curves


def combined_curve(curves: dict[str, np.ndarray], weights: dict[str, float], hop: float) -> np.ndarray:
    total = None
    wsum = 0.0
    for k, c in curves.items():
        w = weights.get(k, 0.0)
        if w <= 0:
            continue
        sm = _smooth(c, 2.0, hop)
        total = sm * w if total is None else total + sm * w
        wsum += w
    if total is None or wsum == 0:
        return np.zeros(len(next(iter(curves.values()))), dtype=np.float32)
    return (total / wsum).astype(np.float32)


def pick_peaks(curve: np.ndarray, hop: float, min_gap: float, limit: int, sensitivity: float) -> list[int]:
    if curve.size == 0:
        return []
    thr = max(0.12 / sensitivity, float(np.percentile(curve, 85)))
    order = np.argsort(curve)[::-1]
    gap = int(min_gap / hop)
    chosen: list[int] = []
    taken = np.zeros(len(curve), dtype=bool)
    for i in order:
        if curve[i] < thr or len(chosen) >= limit:
            break
        if taken[i]:
            continue
        chosen.append(int(i))
        taken[max(0, i - gap): i + gap + 1] = True
    return sorted(chosen)


# ---------------------------------------------------------------------------
# Límites del clip: nunca cortar frases
# ---------------------------------------------------------------------------

def _segment_at(segments: list[Segment], t: float) -> Segment | None:
    for s in segments:
        if s.start - 0.05 <= t <= s.end + 0.05:
            return s
    return None


def snap_start(t: float, segments: list[Segment], silences: np.ndarray, lo: float) -> float:
    """Mueve el inicio al comienzo de la frase que lo contiene (o a una pausa cercana)."""
    s = _segment_at(segments, t)
    if s is not None:
        t = s.start
    elif silences.size:
        near = silences[(silences <= t) & (silences >= t - 3)]
        if near.size:
            t = float(near.max())
    return max(lo, t - 0.15)


def snap_end(t: float, segments: list[Segment], silences: np.ndarray, hi: float) -> float:
    s = _segment_at(segments, t)
    if s is not None:
        t = s.end
    elif silences.size:
        near = silences[(silences >= t) & (silences <= t + 3)]
        if near.size:
            t = float(near.min())
    return min(hi, t + 0.3)


def choose_bounds(peak_i: int, curve: np.ndarray, sig: Signals, params: DetectionParams,
                  silences: np.ndarray) -> tuple[float, float]:
    hop = sig.hop
    dur = sig.duration
    peak_t = peak_i * hop
    target = params.target()
    if target:
        pre = target * 0.45
        post = target * 0.55
    else:
        pre, post = 10.0, 6.0
    # Desenlace: esperar a que la reacción decaiga (≤ 40 % del pico durante 1.5 s)
    peak_v = curve[peak_i]
    decay_len = int(1.5 / hop)
    end_i = peak_i
    limit = min(len(curve), peak_i + int((post if target else 30.0) / hop))
    below = 0
    for j in range(peak_i, limit):
        below = below + 1 if curve[j] <= peak_v * 0.4 else 0
        end_i = j
        if below >= decay_len and (j - peak_i) * hop >= 3.0:
            break
    end_t = max(end_i * hop, peak_t + (post if target else 4.0))
    start_t = peak_t - pre
    # Contexto previo: si hay una frase de planteamiento justo antes, empezar en ella
    if not target and sig.segments:
        prev = [s for s in sig.segments if s.end <= peak_t and s.end >= peak_t - 15]
        if prev:
            start_t = min(start_t, prev[0].start)
    start_t = snap_start(max(0.0, start_t), sig.segments, silences, 0.0)
    end_t = snap_end(min(dur, end_t), sig.segments, silences, dur)

    lo = params.min_duration if not target else target * 0.75
    hi = params.max_duration if not target else target * 1.25
    if params.duration_mode == "auto":
        lo, hi = max(lo, 15.0), min(hi, 60.0)
    # Ajuste de duración sin partir frases: se amplía/recorta por frases completas
    if end_t - start_t < lo:
        missing = lo - (end_t - start_t)
        start_t = snap_start(max(0.0, start_t - missing * 0.5), sig.segments, silences, 0.0)
        end_t = snap_end(min(dur, end_t + missing * 0.5), sig.segments, silences, dur)
        if end_t - start_t < lo:  # al principio/final del vídeo
            end_t = min(dur, start_t + lo)
            start_t = max(0.0, end_t - lo)
    if end_t - start_t > hi:
        # Recorta por los extremos alejándose del pico, respetando frases completas
        segs_in = [s for s in sig.segments if s.start >= start_t and s.end <= end_t]
        while end_t - start_t > hi and segs_in:
            first, last = segs_in[0], segs_in[-1]
            if peak_t - first.end > last.start - peak_t and first.end < peak_t - 2:
                start_t = segs_in[1].start if len(segs_in) > 1 else first.end
                segs_in.pop(0)
            elif last.start > peak_t + 2:
                end_t = segs_in[-2].end if len(segs_in) > 1 else last.start
                segs_in.pop()
            else:
                break
        if end_t - start_t > hi:  # una sola frase muy larga: corte duro alrededor del pico
            start_t = max(start_t, peak_t - hi * 0.45)
            end_t = start_t + hi
    return round(max(0.0, start_t), 3), round(min(dur, end_t), 3)


# ---------------------------------------------------------------------------
# Puntuación del fragmento completo
# ---------------------------------------------------------------------------

def _win(x: np.ndarray, a: float, b: float, hop: float) -> np.ndarray:
    i0, i1 = int(a / hop), max(int(a / hop) + 1, int(b / hop))
    return x[i0:i1]


def score_window(start: float, end: float, peak: float, curves: dict[str, np.ndarray], curve: np.ndarray,
                 sig: Signals, weights: dict[str, float]) -> tuple[dict[str, float], list[str], str, float, str]:
    hop = sig.hop
    comps: dict[str, float] = {}
    reasons: list[str] = []
    segs = [s for s in sig.segments if s.end > start and s.start < end]
    text = " ".join(s.text for s in segs).strip()

    if "semantic" in curves:
        sc = [x for x in sig.seg_scores if x.end > start and x.start < end]
        comps["semantic"] = max([x.interest for x in sc], default=0.0)
        hits = [m for x in sc for m in x.matches][:3]
        if hits:
            reasons.append("Frases clave: " + ", ".join(f"«{h}»" for h in hits))
    vocal = _win(curves["vocal"], peak - 2, peak + 4, hop)
    comps["vocal"] = float(vocal.max()) if vocal.size else 0.0
    zpk = float(_win(sig.audio.z_energy, peak - 2, peak + 4, hop).max(initial=0))
    if zpk > 2.5:
        reasons.append(f"Reacción vocal fuerte (+{zpk:.1f}σ sobre su nivel habitual)")
    if "visual" in curves:
        v = _win(curves["visual"], start, end, hop)
        comps["visual"] = float(np.mean(np.sort(v)[-max(1, len(v) // 5):])) if v.size else 0.0
        cuts = [t for t in sig.scene_cuts if start <= t <= end]
        if comps["visual"] > 0.5:
            reasons.append("Mucho movimiento en pantalla" + (f" y {len(cuts)} cambio(s) de escena" if cuts else ""))
    if "chat" in curves:
        c = _win(curves["chat"], start, end + 8, hop)
        comps["chat"] = float(c.max()) if c.size else 0.0
        if comps["chat"] > 0.4:
            reasons.append("El chat reaccionó con un pico de mensajes")

    pre_words = sum(len(s.text.split()) for s in sig.segments if s.end <= peak and s.start >= start)
    if sig.segments:
        comps["context"] = float(np.clip(pre_words / 20.0, 0, 1))
        story = [x for x in sig.seg_scores if x.start >= start and x.end <= peak and "story" in x.categories]
        if story:
            comps["context"] = min(1.0, comps["context"] + 0.3)
        if pre_words >= 8:
            reasons.append(f"Incluye {peak - start:.0f} s de contexto previo")
    else:
        pre_act = _win(curve, start, peak - 1, hop)
        comps["context"] = float(np.clip((peak - start) / 8.0, 0, 1)) * (0.5 + 0.5 * float(pre_act.mean() > 0.05))

    if segs:
        conf = float(np.mean([s.confidence for s in segs]))
        speech = sum(min(s.end, end) - max(s.start, start) for s in segs) / max(1e-6, end - start)
        comps["clarity"] = float(np.clip(conf * (0.6 + 0.4 * min(1.0, speech / 0.5)), 0, 1))
    else:
        comps["clarity"] = audio_quality(sig.audio, start, end) * 0.7
    comps["audio_quality"] = audio_quality(sig.audio, start, end)

    tail = _win(curve, end - 1.5, end, hop)
    resolved = float(tail.mean()) <= max(0.05, curve[min(len(curve) - 1, int(peak / hop))] * 0.6) if tail.size else True
    ends_sentence = any(abs(s.end - (end - 0.3)) < 0.4 for s in sig.segments) if sig.segments else True
    comps["resolution"] = 0.5 * float(resolved) + 0.5 * float(ends_sentence)
    if resolved and ends_sentence and sig.segments:
        reasons.append("Termina tras el desenlace, sin cortar la frase")
    comps["originality"] = 1.0  # se recalcula en la deduplicación

    # Categoría
    votes: dict[str, float] = {}
    for x in sig.seg_scores:
        if x.end > start and x.start < end:
            for cat, val in x.categories.items():
                votes[cat] = max(votes.get(cat, 0.0), val)
    for ev in sig.audio_events:
        if ev.end > start and ev.start < end:
            if ev.type == "laughter":
                votes["funny"] = max(votes.get("funny", 0), ev.confidence)
                reasons.append("Risas detectadas en el audio")
            elif ev.type == "scream":
                votes["scare"] = max(votes.get("scare", 0), ev.confidence * 0.8)
                votes["reaction"] = max(votes.get("reaction", 0), ev.confidence)
            elif ev.type == "loud_reaction":
                votes["reaction"] = max(votes.get("reaction", 0), ev.confidence * 0.9)
    if sig.chat_raw is not None and "chat" in curves:
        i0, i1 = int(start / hop), int((end + 8) / hop)
        laugh = float(sig.chat_raw["laugh"][i0:i1].sum())
        hype = float(sig.chat_raw["hype"][i0:i1].sum())
        if laugh > hype and laugh > 3:
            votes["funny"] = max(votes.get("funny", 0), 0.7)
        elif hype > 3:
            votes["hype"] = max(votes.get("hype", 0), 0.7)
    if votes:
        category = max(votes, key=votes.get)
    elif "chat" in comps and comps["chat"] > comps.get("semantic", 0):
        category = "chat"
    else:
        category = "conversation" if text else "reaction"

    # Confianza: acuerdo entre modalidades + calidad de la transcripción
    keys = [k for k in ("semantic", "vocal", "visual", "chat") if k in comps]
    agree = sum(1 for k in keys if comps[k] >= 0.45)
    tconf = float(np.mean([s.confidence for s in segs])) if segs else 0.4
    confidence = float(np.clip(0.25 + 0.17 * agree + 0.25 * tconf, 0.05, 0.95))
    return comps, reasons, category, confidence, text


def total_score(comps: dict[str, float], weights: dict[str, float]) -> float:
    num = den = 0.0
    for k, v in comps.items():
        w = weights.get(k, 0.0)
        num += w * v
        den += w
    return round(100.0 * num / den, 1) if den else 0.0


def explanation(category: str, comps: dict[str, float], reasons: list[str]) -> str:
    top = sorted(((k, v) for k, v in comps.items() if k != "originality"), key=lambda kv: kv[1], reverse=True)[:3]
    tops = ", ".join(f"{COMPONENT_LABELS[k].lower()} {v:.0%}" for k, v in top)
    uniq = list(dict.fromkeys(reasons))
    return f"{CATEGORY_LABELS.get(category, category)}. " + ("; ".join(uniq) + ". " if uniq else "") + \
        f"Señales más fuertes: {tops}."


def deduplicate(cands: list[Candidate], weights: dict[str, float], existing: list[Candidate] | None = None,
                max_overlap: float = 0.35, max_text_sim: float = 0.7) -> tuple[list[Candidate], list[Candidate]]:
    """Devuelve (aceptados, duplicados). Recalcula originalidad frente a los ya aceptados."""
    accepted: list[Candidate] = list(existing or [])
    base_n = len(accepted)
    dups: list[Candidate] = []
    for c in sorted(cands, key=lambda x: x.score, reverse=True):
        worst = 0.0
        dup = False
        for a in accepted:
            inter = max(0.0, min(a.end, c.end) - max(a.start, c.start))
            frac = inter / max(1e-6, min(a.duration, c.duration))
            sim = text_similarity(a.text, c.text) if a.text and c.text else 0.0
            if frac > max_overlap or (sim > max_text_sim and len(c.text) > 30):
                dup = True
                break
            worst = max(worst, frac, sim)
        if dup:
            dups.append(c)
            continue
        c.scores["originality"] = round(1.0 - worst, 3)
        c.score = total_score(c.scores, weights)
        accepted.append(c)
    return sorted(accepted[base_n:], key=lambda x: x.score, reverse=True), dups


def generate_candidates(sig: Signals, params: DetectionParams,
                        existing: list[Candidate] | None = None) -> tuple[list[Candidate], list[Candidate]]:
    weights = {**DEFAULT_WEIGHTS, **(params.weights or {})}
    curves = component_curves(sig)
    curve = combined_curve(curves, weights, sig.hop)
    silences = silence_points(sig.audio)
    peaks = pick_peaks(curve, sig.hop, params.min_gap, params.max_candidates * 3, params.sensitivity)
    cands: list[Candidate] = []
    for p in peaks:
        start, end = choose_bounds(p, curve, sig, params, silences)
        if end - start < 3:
            continue
        peak_t = p * sig.hop
        comps, reasons, cat, conf, text = score_window(start, end, peak_t, curves, curve, sig, weights)
        score = total_score(comps, weights)
        cands.append(Candidate(start + sig.time_offset, end + sig.time_offset, peak_t + sig.time_offset, score,
                               {k: round(v, 3) for k, v in comps.items()}, cat, round(conf, 3), "", reasons,
                               text))
    accepted, dups = deduplicate(cands, weights, existing)
    for c in accepted + dups:
        c.explanation = explanation(c.category, c.scores, c.reasons)
    if params.categories:
        accepted = [c for c in accepted if c.category in params.categories]
    accepted = [c for c in accepted if c.score >= params.min_score][: params.max_candidates]
    return accepted, dups
