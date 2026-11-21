"""Smart frame sampling.

We never send a whole VOD to the model. The video is split into fixed-length
segments; each segment gets a few *baseline* frames (regular coverage) plus
*event* frames placed on local peaks of a cheap, locally computed intensity
signal (visual change + audio loudness), which is where fights, builds and
edits usually happen. A global frame budget scales the baseline interval for
long videos so cost stays bounded.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class SampledFrame:
    t: float
    segment: int
    reason: str  # baseline|motion_peak|audio_peak|scene_cut
    intensity: float


@dataclass
class Segment:
    index: int
    start: float
    end: float
    intensity: float  # mean normalised intensity 0..1
    peak: float


def _norm(x: np.ndarray) -> np.ndarray:
    if x.size == 0:
        return x
    lo, hi = np.percentile(x, 5), np.percentile(x, 98)
    if hi - lo < 1e-6:
        return np.zeros_like(x)
    return np.clip((x - lo) / (hi - lo), 0, 1)


def intensity_curve(duration: float, act_t, act, aud_t, aud_db) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return per-second (times, combined, motion_norm, audio_norm)."""
    n = max(1, int(np.ceil(duration)))
    times = np.arange(n, dtype=float)
    motion = np.interp(times, act_t, act) if len(act) else np.zeros(n)
    if len(aud_db):
        # max loudness per second
        per_sec = np.full(n, -90.0)
        idx = np.minimum((aud_t).astype(int), n - 1)
        np.maximum.at(per_sec, idx, aud_db)
        audio = per_sec
    else:
        audio = np.zeros(n)
    m, a = _norm(motion), _norm(audio)
    combined = 0.55 * m + 0.45 * a if len(aud_db) else m
    # light smoothing (3 s)
    if n >= 3:
        combined = np.convolve(combined, np.ones(3) / 3, mode="same")
    return times, combined, m, a


def plan_frames(
    duration: float,
    times: np.ndarray,
    combined: np.ndarray,
    motion: np.ndarray,
    audio: np.ndarray,
    *,
    segment_seconds: int,
    max_total: int,
    max_per_segment: int,
    skip_mask: np.ndarray | None = None,
) -> tuple[list[Segment], list[SampledFrame]]:
    nseg = max(1, int(np.ceil(duration / segment_seconds)))
    # Budget: baseline gets ~45%, event frames the rest, capped per segment.
    per_seg_budget = max(3, min(max_per_segment, max_total // nseg))
    baseline_n = max(2, int(round(per_seg_budget * 0.45)))
    segments: list[Segment] = []
    frames: list[SampledFrame] = []
    # Event score: smoothed combined signal, but short sharp spikes in either
    # channel (a shotgun blast, a sudden 90° turn) also count.
    score = combined.copy()
    if motion.size == score.size:
        score = np.maximum(score, 0.9 * motion)
    if audio.size == score.size:
        score = np.maximum(score, 0.9 * audio)
    for i in range(nseg):
        s0, s1 = i * segment_seconds, min(duration, (i + 1) * segment_seconds)
        sl = slice(int(s0), max(int(s0) + 1, int(np.ceil(s1))))
        seg_c = combined[sl] if combined.size else np.zeros(1)
        segments.append(Segment(i, s0, s1, float(seg_c.mean()) if seg_c.size else 0.0, float(seg_c.max()) if seg_c.size else 0.0))
        chosen: list[SampledFrame] = []
        span = s1 - s0
        for k in range(baseline_n):
            t = s0 + span * (k + 0.5) / baseline_n
            chosen.append(SampledFrame(round(t, 2), i, "baseline", float(combined[min(int(t), len(combined) - 1)]) if combined.size else 0))
        # event frames: local maxima above 0.45, at least 2.5 s apart
        cand = []
        for j in range(sl.start, min(sl.stop, len(score))):
            v = score[j]
            if v < 0.45:
                continue
            lo, hi = max(0, j - 2), min(len(score), j + 3)
            if v >= score[lo:hi].max():
                reason = "audio_peak" if audio.size and audio[j] > motion[j] else "motion_peak"
                cand.append((v, j, reason))
        cand.sort(reverse=True)
        extra = per_seg_budget - baseline_n
        for v, j, reason in cand:
            if extra <= 0:
                break
            t = float(j) + 0.5
            if t >= s1:
                continue
            near = [c for c in chosen if abs(t - c.t) < 2.5]
            if near:
                # move a nearby baseline frame onto the peak instead of adding one
                base = next((c for c in near if c.reason == "baseline"), None) if v > 0.7 else None
                if base is None:
                    continue
                chosen.remove(base)
                chosen.append(SampledFrame(round(t, 2), i, reason, float(v)))
                continue
            chosen.append(SampledFrame(round(t, 2), i, reason, float(v)))
            extra -= 1
            # also capture the build-up 1.5 s earlier for high peaks (fights start before the loud moment)
            if v > 0.75 and extra > 0 and t - 1.5 > s0 and not any(abs(t - 1.5 - c.t) < 1.2 for c in chosen):
                chosen.append(SampledFrame(round(t - 1.5, 2), i, reason, float(v)))
                extra -= 1
        if skip_mask is not None:
            chosen = [c for c in chosen if not skip_mask[min(int(c.t), len(skip_mask) - 1)]] or chosen[:1]
        frames.extend(sorted(chosen, key=lambda f: f.t))
    return segments, frames
