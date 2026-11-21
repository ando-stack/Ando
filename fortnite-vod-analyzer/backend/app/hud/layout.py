"""HUD layouts: normalised rectangles (x0, y0, x1, y1 in 0..1 of the frame) for each
value the reader extracts.

Fortnite lets every player move and resize HUD elements, and the default HUD
changes between seasons, so the preset below is only a starting point. The
coach calibrates each player once in the UI (draws the boxes on a real frame
and checks the live reading); calibrated layouts produce high-confidence
readings, the preset produces low-confidence ones.
"""
from __future__ import annotations

FIELDS = {
    "health": {"label": "Vida", "max": 200, "kind": "int"},
    "shield": {"label": "Escudo", "max": 200, "kind": "int"},
    "wood": {"label": "Madera", "max": 9999, "kind": "int"},
    "brick": {"label": "Ladrillo", "max": 9999, "kind": "int"},
    "metal": {"label": "Metal", "max": 9999, "kind": "int"},
    "players_remaining": {"label": "Jugadores restantes", "max": 150, "kind": "int"},
    "eliminations": {"label": "Eliminaciones", "max": 99, "kind": "int"},
    "storm_timer": {"label": "Temporizador de tormenta", "max": None, "kind": "time"},
}

# Approximate default HUD at 16:9. MUST be calibrated for reliable readings.
DEFAULT_PRESET = {
    "name": "Predeterminado 16:9 (aproximado)",
    "calibrated": False,
    "rects": {
        "shield": [0.028, 0.885, 0.085, 0.918],
        "health": [0.028, 0.920, 0.085, 0.955],
        "wood": [0.905, 0.605, 0.965, 0.638],
        "brick": [0.905, 0.640, 0.965, 0.673],
        "metal": [0.905, 0.675, 0.965, 0.708],
        "players_remaining": [0.835, 0.300, 0.885, 0.335],
        "eliminations": [0.895, 0.300, 0.945, 0.335],
        "storm_timer": [0.775, 0.300, 0.830, 0.335],
    },
}


def normalize_layout(layout: dict | None) -> dict:
    """Validate a layout coming from the API/DB. Unknown fields are dropped."""
    if not layout:
        return {**DEFAULT_PRESET, "rects": dict(DEFAULT_PRESET["rects"])}
    rects = {}
    for k, r in (layout.get("rects") or {}).items():
        if k not in FIELDS or r is None:
            continue
        if not (isinstance(r, (list, tuple)) and len(r) == 4):
            raise ValueError(f"Rectángulo inválido para {k}")
        x0, y0, x1, y1 = (float(v) for v in r)
        x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
        y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
        if x1 - x0 < 0.004 or y1 - y0 < 0.004:
            raise ValueError(f"Rectángulo demasiado pequeño para {k}")
        rects[k] = [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)]
    return {"name": str(layout.get("name") or "Personalizado")[:80], "calibrated": bool(layout.get("calibrated", True)), "rects": rects}
