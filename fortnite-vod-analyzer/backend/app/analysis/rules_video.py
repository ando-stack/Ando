"""Deterministic coaching rules over HUD readings + audio/visual intensity.

No generative AI: every finding is computed from measured values and cites
the sampled frames (ids H0001…) where the values were read, so the coach can
open the frame and verify it. Rules only fire when the needed readings exist.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..hud.reader import HudSample
from .engine import fmt_t

STORM_THRESHOLD = 0.35


@dataclass
class Fight:
    start: float
    end: float
    peak: float


def hid(i: int) -> str:
    return f"H{i + 1:04d}"


# ---------------------------------------------------------------- cleaning
def clean_series(samples: list[HudSample]) -> None:
    """Remove OCR outliers in place (never invents values, only drops them)."""
    def despike(field: str, jump: float):
        idx = [i for i, s in enumerate(samples) if field in s.values]
        for a, b, c in zip(idx, idx[1:], idx[2:]):
            va, vb, vc = samples[a].values[field], samples[b].values[field], samples[c].values[field]
            if abs(vb - va) > jump and abs(vb - vc) > jump and abs(va - vc) <= jump / 3:
                samples[b].values.pop(field, None)
                samples[b].conf.pop(field, None)

    for f, j in (("health", 60), ("shield", 60), ("wood", 250), ("brick", 250), ("metal", 250)):
        despike(f, j)
    # players remaining can only go down: drop readings above the running minimum (+1 tolerance)
    lowest = None
    for s in samples:
        v = s.values.get("players_remaining")
        if v is None:
            continue
        if lowest is not None and v > lowest + 1:
            s.values.pop("players_remaining")
            s.conf.pop("players_remaining", None)
            continue
        lowest = v if lowest is None else min(lowest, v)


def detect_fights(times: np.ndarray, combined: np.ndarray, has_audio: bool) -> list[Fight]:
    if combined.size == 0:
        return []
    thr = 0.55 if has_audio else 0.7
    hot = combined >= thr
    fights, start = [], None
    for i, h in enumerate(hot):
        if h and start is None:
            start = i
        if (not h or i == len(hot) - 1) and start is not None:
            end = i if not h else i + 1
            fights.append([float(times[start]), float(times[min(end, len(times) - 1)]), float(combined[start:end + 1].max())])
            start = None
    merged: list[list[float]] = []
    for f in fights:
        if merged and f[0] - merged[-1][1] <= 8:
            merged[-1][1] = f[1]
            merged[-1][2] = max(merged[-1][2], f[2])
        else:
            merged.append(f)
    return [Fight(a, b, p) for a, b, p in merged if b - a >= 6]


def _near(samples: list[HudSample], t: float, field: str, before: float = 8.0, after: float = 0.0) -> tuple[int, HudSample] | None:
    best = None
    for i, s in enumerate(samples):
        if field in s.values and t - before <= s.t <= t + after:
            if best is None or abs(s.t - t) < abs(best[1].t - t):
                best = (i, s)
    return best


def _hp(s: HudSample) -> int | None:
    if "health" not in s.values:
        return None
    return s.values["health"] + s.values.get("shield", 0)


def _conf(s: HudSample, *fields: str) -> float:
    vals = [s.conf.get(f, 0.4) for f in fields if f in s.values]
    return round(min(vals) if vals else 0.4, 2)


# ---------------------------------------------------------------- rules
def run_rules(samples: list[HudSample], fights: list[Fight], phase_of, duration: float) -> dict:
    findings: list[dict] = []
    strengths: list[dict] = []

    def add(**f):
        ev = f.pop("evidence")
        f["evidence"] = ev
        findings.append(f)

    # R1 — time in storm
    i = 0
    while i < len(samples):
        if samples[i].storm >= STORM_THRESHOLD:
            j = i
            while j + 1 < len(samples) and samples[j + 1].storm >= STORM_THRESHOLD:
                j += 1
            if j - i + 1 >= 3:
                secs = samples[j].t - samples[i].t
                hps = [_hp(s) for s in samples[i:j + 1] if _hp(s) is not None]
                low = min(hps) if hps else None
                sev = "critical" if (low is not None and low <= 30) else "high" if secs >= 30 else "medium" if secs >= 12 else "low"
                add(category="rotation", error_type="strategy", severity=sev, t_start=samples[i].t, t_end=samples[j].t,
                    title=f"{int(secs)} s dentro de la tormenta",
                    what_happened=f"Desde {fmt_t(samples[i].t)} hasta {fmt_t(samples[j].t)} la pantalla muestra el tinte de la tormenta en {j - i + 1} muestras seguidas" + (f"; la vida+escudo baja hasta {low}." if low is not None else "."),
                    why_error="Recibir daño de tormenta gasta curaciones y deja al jugador vulnerable a quien ya está dentro de la zona; suele ser consecuencia de rotar tarde o de alargar una pelea.",
                    what_to_do="Empezar la rotación al anunciarse el siguiente círculo (o en cuanto termine la pelea) y entrar por el lado con cobertura.",
                    how_to_avoid="Fijar una regla: con menos de 30 s para el cierre y fuera de la siguiente zona, rotar antes de lootear. Practicar en mapas de zone wars.",
                    confidence=0.6, evidence=[hid(i), hid(j)] if j != i else [hid(i)])
            i = j + 1
        else:
            i += 1

    # R2 / strength — resources when the fight starts
    entered_full = 0
    for f in fights:
        near = _near(samples, f.start, "health", before=8, after=1)
        if not near:
            continue
        k, s = near
        hp = _hp(s)
        if hp is None:
            continue
        if hp <= 100:
            sev = "high" if hp <= 60 else "medium"
            add(category="decision", error_type="decision", severity=sev, t_start=f.start, t_end=f.end,
                title=f"Pelea iniciada con {hp} de vida+escudo",
                what_happened=f"En {fmt_t(s.t)} el HUD marca {s.values.get('health')} de vida y {s.values.get('shield', 0)} de escudo; justo después empieza un intercambio intenso ({fmt_t(f.start)}–{fmt_t(f.end)}).",
                why_error="Entrar en una pelea con la mitad de recursos o menos convierte cualquier intercambio en una desventaja y facilita el third party.",
                what_to_do="Antes de comprometerse: curarse a cubierto (box + escudo) o desengancharse; solo forzar la pelea si el rival está igual o peor.",
                how_to_avoid="Checklist antes de pelear: ¿vida+escudo ≥ 150? ¿mats ≥ 300? Si no, primero recursos.",
                confidence=_conf(s, "health", "shield"), evidence=[hid(k)])
        elif hp >= 175:
            entered_full += 1
            strengths.append({"module": "fight", "description": f"Entra en la pelea de {fmt_t(f.start)} con {hp} de vida+escudo.", "evidence": [hid(k)], "t": s.t})

    # R3 — healing after fights
    for f in fights:
        after = [(k, s) for k, s in enumerate(samples) if f.end < s.t <= f.end + 30 and _hp(s) is not None]
        if len(after) < 3:
            continue
        nxt = next((g for g in fights if g.start > f.end), None)
        if nxt and nxt.start < f.end + 30:
            continue  # next fight started right away; not a healing window
        hps = [_hp(s) for _, s in after]
        if max(hps) < 120:
            k0, s0 = after[0]
            k1, s1 = after[-1]
            add(category="healing", error_type="decision", severity="medium", t_start=s0.t, t_end=s1.t,
                title="No se recupera tras la pelea",
                what_happened=f"Tras la pelea que termina en {fmt_t(f.end)}, durante ~30 s la vida+escudo no supera {max(hps)} (de {fmt_t(s0.t)} a {fmt_t(s1.t)}).",
                why_error="Después de una pelea es el momento más probable de recibir un third party; seguir bajo de vida lo convierte en un objetivo fácil.",
                what_to_do="Asegurar la posición (box/cobertura), curarse y rellenar escudo antes de lootear o rotar.",
                how_to_avoid="Rutina post-pelea: box → curación → mats → loot. Entrenarla en box fights encadenadas.",
                confidence=min(_conf(s0, "health"), _conf(s1, "health")), evidence=[hid(k0), hid(k1)])
        elif max(hps) >= 175:
            k, s = next((k, s) for k, s in after if _hp(s) >= 175)
            strengths.append({"module": "decision", "description": f"Se recupera a {_hp(s)} de vida+escudo en {int(s.t - f.end)} s tras la pelea.", "evidence": [hid(k)], "t": s.t})

    # R4 — materials in the late game
    late = [(k, s) for k, s in enumerate(samples) if phase_of(s.t) == "end" and all(m in s.values for m in ("wood", "brick", "metal"))]
    if late:
        low = [(k, s) for k, s in late if sum(s.values[m] for m in ("wood", "brick", "metal")) < 300]
        if len(low) >= 2:
            k, s = low[0]
            tot = sum(s.values[m] for m in ("wood", "brick", "metal"))
            add(category="materials", error_type="strategy", severity="high" if tot < 150 else "medium", t_start=s.t, t_end=low[-1][1].t,
                title=f"Endgame con solo {tot} materiales",
                what_happened=f"En {fmt_t(s.t)} el HUD marca madera {s.values['wood']}, ladrillo {s.values['brick']}, metal {s.values['metal']} durante la fase final ({len(low)} muestras por debajo de 300).",
                why_error="En las últimas zonas los materiales son vida: sin ellos no se puede tarpar, rotar con cobertura ni sostener la altura.",
                what_to_do="Farmear en el mid game hasta tener al menos 500–800 de madera y priorizar el loot de mats de los eliminados.",
                how_to_avoid="Objetivo de mats por fase (p. ej. 500 al primer cierre, 999 al llegar a top 25) y revisarlo en cada VOD.",
                confidence=_conf(s, "wood", "brick", "metal"), evidence=[hid(k), hid(low[-1][0])])
        rich = [(k, s) for k, s in late if sum(s.values[m] for m in ("wood", "brick", "metal")) >= 900]
        if rich and not low:
            strengths.append({"module": "endgame", "description": f"Llega al endgame con {sum(rich[0][1].values[m] for m in ('wood','brick','metal'))} materiales.", "evidence": [hid(rich[0][0])], "t": rich[0][1].t})

    # R5 — playing without shield
    run_start = None
    for k, s in enumerate(samples + [HudSample(t=1e12, values={"shield": 100})]):
        sh = s.values.get("shield")
        if sh == 0 and phase_of(s.t) in ("mid", "end"):
            if run_start is None:
                run_start = k
        elif sh is not None and sh > 0 and run_start is not None:
            last = k - 1
            secs = samples[last].t - samples[run_start].t
            if secs >= 60:
                add(category="healing", error_type="decision", severity="medium", t_start=samples[run_start].t, t_end=samples[last].t,
                    title=f"{int(secs)} s sin escudo en mid/endgame",
                    what_happened=f"El escudo marca 0 desde {fmt_t(samples[run_start].t)} hasta {fmt_t(samples[last].t)}.",
                    why_error="Sin escudo cualquier intercambio de daño es letal; en mid y endgame los rivales tienen mejor loot.",
                    what_to_do="Priorizar escudos al lootear y no gastar tiempo en otros objetos mientras el escudo esté a 0.",
                    how_to_avoid="Mantener siempre un slot de escudos y revisar inventario después de cada pelea.",
                    confidence=_conf(samples[run_start], "shield"), evidence=[hid(run_start), hid(last)])
            run_start = None

    # Strength — never in the storm with readable data
    if not any(f["category"] == "rotation" for f in findings) and any(s.storm < 0.05 for s in samples):
        strengths.append({"module": "rotation", "description": "No se detecta tiempo dentro de la tormenta en todo el vídeo.", "evidence": [hid(len(samples) // 2)], "t": samples[len(samples) // 2].t})

    hp_read = sum(1 for s in samples if "health" in s.values)
    mats_read = sum(1 for s in samples if "wood" in s.values)
    left_read = sum(1 for s in samples if "players_remaining" in s.values)
    assessable = {
        "rotation": True,  # storm colour detection works without OCR
        "fight": bool(fights) and hp_read > 0,
        "decision": bool(fights) and hp_read > 0,
        "endgame": mats_read > 0 and any(phase_of(s.t) == "end" for s in samples),
        "positioning": False,
        "mechanics": False,
        "communication": False,
    }
    return {
        "findings": findings,
        "strengths": strengths,
        "assessable": assessable,
        "readings": {"health": hp_read, "materials": mats_read, "players_remaining": left_read, "samples": len(samples)},
        "fights_full_resources": entered_full,
    }
