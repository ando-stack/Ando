"""HUD reading pass + rules (always runs; no generative AI)."""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

from ..hud.reader import HudReader, HudSample, iter_frames
from . import rules_video
from .engine import fmt_t


def read_hud(src: Path, duration: float, layout: dict, every: float, out_dir: Path, progress) -> list[HudSample]:
    reader = HudReader(layout)
    out_dir.mkdir(parents=True, exist_ok=True)
    samples: list[HudSample] = []
    total = max(1, int(duration / every))
    for i, (t, frame) in enumerate(iter_frames(src, every)):
        s = reader.read(frame, t)
        samples.append(s)
        im = Image.fromarray(frame)
        im.thumbnail((960, 960))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=80)
        (out_dir / f"{rules_video.hid(i)}.jpg").write_bytes(buf.getvalue())
        if i % 10 == 0:
            progress(min(1.0, i / total))
    rules_video.clean_series(samples)
    return samples


def phase_from_samples(samples: list[HudSample], duration: float):
    pts = [(s.t, s.values["players_remaining"]) for s in samples if "players_remaining" in s.values]
    if len(pts) >= 3:
        start = max(v for _, v in pts)

        def phase(t: float) -> str:
            prior = [v for tt, v in pts if tt <= t] or [pts[0][1]]
            frac = prior[-1] / start if start else 1
            return "early" if frac > 0.6 else "mid" if frac > 0.25 else "end"

        return phase, "hud_players_remaining"

    def phase(t: float) -> str:
        x = t / max(1.0, duration)
        return "early" if x < 1 / 3 else "mid" if x < 2 / 3 else "end"

    return phase, "time_thirds_estimated"


def rules_findings(samples, fights, phase_of, duration) -> dict:
    res = rules_video.run_rules(samples, fights, phase_of, duration)
    t_of = {rules_video.hid(i): s.t for i, s in enumerate(samples)}
    for f in res["findings"]:
        f["module"] = "rules"
        f["phase"] = phase_of(f["t_start"])
        f["t_start"] = round(f["t_start"], 2)
        f["t_end"] = round(f["t_end"], 2) if f.get("t_end") and f["t_end"] > f["t_start"] else None
        f["evidence"] = [{"id": e, "t": round(t_of[e], 2), "kind": "frame"} for e in f["evidence"]]
        f["confidence"] = round(float(f["confidence"]), 2)
    return res


def hud_timeline(samples: list[HudSample], fights) -> list[dict]:
    items = []
    for i, s in enumerate(samples):
        if not s.values and s.storm < rules_video.STORM_THRESHOLD:
            continue
        items.append({"id": rules_video.hid(i), "kind": "hud", "t": s.t, "hud": s.values, "storm": round(s.storm, 2),
                      "description": " · ".join(f"{k} {v}" for k, v in s.values.items()) + (" · TORMENTA" if s.storm >= rules_video.STORM_THRESHOLD else "")})
    for n, f in enumerate(fights):
        items.append({"id": f"P{n + 1:03d}", "kind": "event", "type": "fight_detected", "t": round(f.start, 2), "t_end": round(f.end, 2),
                      "description": f"Intercambio intenso detectado por audio/imagen ({fmt_t(f.start)}–{fmt_t(f.end)})"})
    return items


def hud_stats(samples: list[HudSample], fights, calibrated: bool, every: float) -> dict:
    legible = [s for s in samples if "health" in s.values]
    left = [s.values["players_remaining"] for s in samples if "players_remaining" in s.values]
    elims = [s.values["eliminations"] for s in samples if "eliminations" in s.values]
    storm = sum(1 for s in samples if s.storm >= rules_video.STORM_THRESHOLD)
    hp = [s.values["health"] + s.values.get("shield", 0) for s in legible]
    return {
        "hud_samples": len(samples),
        "hud_every_s": every,
        "hud_calibrated": calibrated,
        "hud_legible_pct": round(100 * len(legible) / len(samples)) if samples else 0,
        "materials_legible_pct": round(100 * sum(1 for s in samples if "wood" in s.values) / len(samples)) if samples else 0,
        "players_remaining_min": min(left) if left else None,
        "eliminations_hud_max": max(elims) if elims else None,
        "storm_seconds": round(storm * every),
        "fights_detected": len(fights),
        "avg_health_shield": round(float(np.mean(hp))) if hp else None,
    }
