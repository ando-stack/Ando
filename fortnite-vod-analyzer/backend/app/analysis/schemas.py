"""JSON schemas used as *structured outputs* for every model call.

Every claim the model makes must cite evidence ids (frame labels like F0007
or replay event ids like E012). The pipeline drops anything that cites ids
that do not exist, which is how we enforce "never invent events".
"""
from __future__ import annotations

CATEGORIES = [
    "positioning", "rotation", "fight", "endgame", "decision", "mechanics",
    "materials", "healing", "survival", "communication",
]
CATEGORY_LABELS = {
    "positioning": "Posicionamiento",
    "rotation": "Rotaciones",
    "fight": "Peleas",
    "endgame": "Endgame",
    "decision": "Toma de decisiones",
    "mechanics": "Mecánicas",
    "materials": "Gestión de materiales",
    "healing": "Curaciones",
    "survival": "Supervivencia",
    "communication": "Comunicación",
}
ERROR_TYPES = ["mechanical", "positioning", "decision", "strategy", "communication"]
ERROR_TYPE_LABELS = {
    "mechanical": "Error mecánico",
    "positioning": "Error de posicionamiento",
    "decision": "Error de decisión",
    "strategy": "Error de estrategia",
    "communication": "Error de comunicación",
}
SEVERITIES = ["low", "medium", "high", "critical"]
SITUATIONS = [
    "bus_or_drop", "looting", "rotating", "fighting", "building", "editing", "healing",
    "idle_or_holding", "in_storm", "downed", "eliminated", "spectating", "victory", "menu_or_lobby", "unknown",
]
EVENT_TYPES = [
    "landing", "fight_start", "fight_end", "enemy_knocked", "enemy_eliminated", "player_knocked",
    "player_eliminated", "took_damage", "dealt_damage", "healed", "rotation_start", "storm_damage",
    "build_fight", "edit_play", "third_party", "vehicle", "victory", "loot", "other",
]


def _nullable(t: str) -> dict:
    return {"type": [t, "null"]}


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}


_str = {"type": "string"}
_conf = {"type": "number"}
_ids = {"type": "array", "items": {"type": "string"}}

SEGMENT_SCHEMA = _obj(
    {
        "content_type": {"type": "string", "enum": ["gameplay", "spectating", "menu_or_lobby", "replay_mode", "not_fortnite", "mixed"]},
        "image_quality": {"type": "string", "enum": ["good", "fair", "poor"]},
        "segment_summary": _str,
        "frames": {
            "type": "array",
            "items": _obj(
                {
                    "frame": _str,
                    "situation": {"type": "string", "enum": SITUATIONS},
                    "health": _nullable("integer"),
                    "shield": _nullable("integer"),
                    "wood": _nullable("integer"),
                    "brick": _nullable("integer"),
                    "metal": _nullable("integer"),
                    "players_remaining": _nullable("integer"),
                    "eliminations": _nullable("integer"),
                    "storm_info": _nullable("string"),
                    "height": {"type": "string", "enum": ["high_ground", "level", "low_ground", "unknown"]},
                    "cover": {"type": "string", "enum": ["covered", "partial", "exposed", "unknown"]},
                    "zone": {"type": "string", "enum": ["safe_center", "safe_edge", "outside_safe", "in_storm", "unknown"]},
                    "description": _str,
                }
            ),
        },
        "events": {
            "type": "array",
            "items": _obj(
                {
                    "type": {"type": "string", "enum": EVENT_TYPES},
                    "frames": _ids,
                    "description": _str,
                    "confidence": _conf,
                }
            ),
        },
        "observations": {
            "type": "array",
            "items": _obj(
                {
                    "category": {"type": "string", "enum": CATEGORIES},
                    "kind": {"type": "string", "enum": ["mistake", "good", "neutral"]},
                    "frames": _ids,
                    "description": _str,
                    "confidence": _conf,
                }
            ),
        },
        "not_verifiable": {"type": "array", "items": _str},
    }
)

MODULE_SCHEMA = _obj(
    {
        "summary": _str,
        "assessable": {"type": "boolean"},
        "findings": {
            "type": "array",
            "items": _obj(
                {
                    "title": _str,
                    "category": {"type": "string", "enum": CATEGORIES},
                    "error_type": {"type": "string", "enum": ERROR_TYPES},
                    "severity": {"type": "string", "enum": SEVERITIES},
                    "evidence": _ids,
                    "what_happened": _str,
                    "why_error": _str,
                    "what_to_do": _str,
                    "how_to_avoid": _str,
                    "confidence": _conf,
                }
            ),
        },
        "strengths": {"type": "array", "items": _obj({"description": _str, "evidence": _ids})},
        "not_assessable": {"type": "array", "items": _str},
    }
)

REPORT_SCHEMA = _obj(
    {
        "match_summary": _str,
        "overall_evaluation": _str,
        "strengths": {"type": "array", "items": _str},
        "weaknesses": {"type": "array", "items": _str},
        "top_errors_commentary": {"type": "array", "items": _obj({"finding_ref": _str, "comment": _str})},
        "early_game": _str,
        "mid_game": _str,
        "endgame": _str,
        "fights": _str,
        "recommendations": {"type": "array", "items": _obj({"title": _str, "detail": _str, "category": {"type": "string", "enum": CATEGORIES}})},
        "drills": {"type": "array", "items": _obj({"name": _str, "goal": _str, "how": _str, "duration_minutes": {"type": "integer"}, "category": {"type": "string", "enum": CATEGORIES}})},
        "next_session_goals": {"type": "array", "items": _obj({"title": _str, "measurable_target": _str, "category": {"type": "string", "enum": CATEGORIES}})},
        "limitations": {"type": "array", "items": _str},
    }
)
