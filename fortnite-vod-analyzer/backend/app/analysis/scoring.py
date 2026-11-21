"""Transparent, reproducible scoring.

Scores are *orientative* coaching indicators computed by this application from
the verified findings. They are NOT official Epic Games statistics.

Per category:
    penalty   = Σ severity_weight × (0.5 + 0.5 × confidence)      (dismissed findings excluded)
    scaled    = penalty × 10 / max(10, analysed_minutes)           (errors per 10 min of footage)
    bonus     = min(10, 3 × strengths_with_evidence)
    score     = clamp(100 − scaled + bonus, 0, 100)
A category is "sin datos" (null) when its module reported it could not be
assessed, or when no analysed footage/data covers it.
Overall = weighted mean of the available category scores.
"""
from __future__ import annotations

SEVERITY_WEIGHTS = {"low": 4, "medium": 9, "high": 16, "critical": 25}

SCORE_CATEGORIES = {
    "positioning": ("Posicionamiento", ["positioning"], 1.1),
    "rotation": ("Rotaciones", ["rotation"], 1.0),
    "fight": ("Peleas", ["fight"], 1.2),
    "endgame": ("Endgame", ["endgame"], 1.0),
    "decision": ("Toma de decisiones", ["decision"], 1.2),
    "mechanics": ("Mecánicas", ["mechanics"], 0.8),
    "resources": ("Materiales y curaciones", ["materials", "healing"], 0.7),
    "survival": ("Supervivencia", ["survival"], 1.0),
    "communication": ("Comunicación", ["communication"], 0.5),
}

# Which analyzer module decides whether a score category is assessable.
CATEGORY_MODULE = {
    "positioning": "positioning",
    "rotation": "rotation",
    "fight": "fight",
    "endgame": "endgame",
    "decision": "decision",
    "mechanics": "mechanics",
    "resources": "endgame",
    "survival": "positioning",
    "communication": "communication",
}

METHODOLOGY = {
    "disclaimer": "Puntuación orientativa calculada por esta herramienta a partir de los errores verificados. No es una estadística oficial de Epic Games ni de ningún torneo.",
    "severity_weights": SEVERITY_WEIGHTS,
    "formula": "100 − Σ(peso_gravedad × (0.5 + 0.5 × confianza)) × 10 / max(10, minutos_analizados) + min(10, 3 × aciertos)",
    "notes": [
        "Los errores descartados por el coach no penalizan; al descartarlos la puntuación se recalcula.",
        "Una categoría sin datos suficientes se muestra como 'sin datos' y no cuenta en la media.",
        "La media global pondera: peleas y decisiones 1.2, posicionamiento 1.1, mecánicas 0.8, recursos 0.7, comunicación 0.5, resto 1.0.",
    ],
}


def compute_scores(findings: list[dict], strengths: dict[str, int], assessable: dict[str, bool], analysed_minutes: float) -> dict:
    minutes = max(10.0, analysed_minutes or 0.0)
    out: dict[str, dict] = {}
    for key, (label, cats, _w) in SCORE_CATEGORIES.items():
        module = CATEGORY_MODULE[key]
        ok = assessable.get(module, False)
        related = [f for f in findings if f["category"] in cats and f.get("review_status") != "dismissed"]
        # A category with findings is always assessable (there is evidence).
        if not ok and not related:
            out[key] = {"label": label, "score": None, "reason": "Sin datos suficientes", "penalty": 0, "findings": 0}
            continue
        penalty = sum(SEVERITY_WEIGHTS.get(f["severity"], 9) * (0.5 + 0.5 * float(f.get("confidence") or 0.6)) for f in related)
        scaled = penalty * 10.0 / minutes
        bonus = min(10.0, 3.0 * sum(strengths.get(c, 0) for c in cats))
        score = max(0.0, min(100.0, 100.0 - scaled + bonus))
        out[key] = {
            "label": label,
            "score": round(score),
            "penalty": round(scaled, 1),
            "bonus": round(bonus, 1),
            "findings": len(related),
        }
    avail = [(out[k]["score"], SCORE_CATEGORIES[k][2]) for k in out if out[k]["score"] is not None]
    overall = round(sum(s * w for s, w in avail) / sum(w for _, w in avail)) if avail else None
    return {"overall": overall, "categories": out, "analysed_minutes": round(analysed_minutes or 0, 1), "methodology": METHODOLOGY}
