"""Deterministic coaching rules over parsed replay events (no AI).
Evidence = replay event ids (E###) with their exact replay time."""
from __future__ import annotations

from .engine import fmt_t


def run_replay_rules(events: list[dict], stats: dict, length_s: float) -> dict:
    findings, strengths = [], []
    by_type = lambda *ts: [e for e in events if e["type"] in ts]
    own = by_type("enemy_knocked", "enemy_eliminated")
    hits = by_type("player_knocked", "player_eliminated")
    death = next((e for e in events if e["type"] == "player_eliminated"), None)

    # R1 — punished right after own fight (re-peek / third party)
    for h in hits:
        prev = [e for e in own if 0 < h["t"] - e["t"] <= 20]
        if prev:
            p = prev[-1]
            gap = h["t"] - p["t"]
            findings.append(dict(
                category="decision", error_type="decision", severity="critical" if h["type"] == "player_eliminated" else "high",
                t_start=p["t"], t_end=h["t"], title=f"{'Eliminado' if h['type'] == 'player_eliminated' else 'Derribado'} {int(gap)} s después de su propio {'knock' if p['type'] == 'enemy_knocked' else 'kill'}",
                what_happened=f"{fmt_t(p['t'])}: {p['description']}. {fmt_t(h['t'])}: {h['description']}.",
                why_error="Justo después de ganar un intercambio el jugador está con menos vida y posición revelada por el ruido; es la ventana típica del third party o del re-peek rival.",
                what_to_do="Tras el knock/kill: cubrirse (box), curar y escanear antes de lootear o empujar al siguiente.",
                how_to_avoid="Rutina post-pelea en creativo (box fights encadenadas) y regla de 'no loot sin box'.",
                confidence=0.75, evidence=[p["id"], h["id"]]))

    # R2 — storm / fall / self-inflicted death
    if death and "tormenta/caída" in death["description"]:
        findings.append(dict(
            category="rotation", error_type="strategy", severity="critical", t_start=death["t"], t_end=None,
            title="Eliminado por la tormenta o una caída",
            what_happened=f"{fmt_t(death['t'])}: la eliminación no la causa ningún rival (tormenta, caída o daño propio).",
            why_error="Es una eliminación evitable que no depende del rival.",
            what_to_do="Revisar el timing de rotación y la ruta; llevar movilidad o curaciones para cruzar tormenta.",
            how_to_avoid="Rotar con el anuncio de zona y no quedarse sin mats para rampas.",
            confidence=0.8, evidence=[death["id"]]))

    # R3 — outside the next safe zone (needs synced positions)
    for e in by_type("outside_next_zone"):
        dur = (e.get("t_end") or e["t"]) - e["t"]
        findings.append(dict(
            category="rotation", error_type="strategy", severity="high" if dur >= 30 else "medium", t_start=e["t"], t_end=e.get("t_end"),
            title="Fuera del siguiente círculo", what_happened=f"{fmt_t(e['t'])}: {e['description']}.",
            why_error="Quedarse fuera del siguiente círculo obliga a rotar con prisa, normalmente expuesto y con jugadores ya posicionados.",
            what_to_do="Entrar en el siguiente círculo antes de que empiece a cerrar, usando la ruta con más cobertura.",
            how_to_avoid="Mirar el mapa al anunciarse cada zona y decidir la ruta en ese momento.",
            confidence=0.85, evidence=[e["id"]]))

    # R4 — early death without impact
    if death and death["t"] < length_s * 0.25 and not own:
        findings.append(dict(
            category="decision", error_type="strategy", severity="high", t_start=death["t"], t_end=None,
            title="Eliminado en el early game sin eliminaciones",
            what_happened=f"Eliminado en {fmt_t(death['t'])} (primer 25 % de la partida) sin knocks ni eliminaciones propias.",
            why_error="Una muerte temprana sin impacto deja la partida sin puntos de placement ni de eliminación.",
            what_to_do="Revisar la zona de aterrizaje (disputada o no) y el primer enfrentamiento: ¿había loot suficiente?",
            how_to_avoid="Tener un aterrizaje fijo y practicado; si está disputado, plan B de rotación.",
            confidence=0.7, evidence=[death["id"]]))

    for e in own:
        strengths.append({"module": "fight", "description": e["description"], "evidence": [e["id"]], "t": e["t"]})
    if stats.get("placement") and stats["placement"] <= 10:
        strengths.append({"module": "endgame", "description": f"Termina en el puesto {stats['placement']}.", "evidence": [events[-1]["id"]], "t": events[-1]["t"]})

    assessable = {"fight": bool(own or hits), "decision": True, "endgame": True,
                  "rotation": bool(by_type("zone_shrink_start", "outside_next_zone")) or bool(death),
                  "positioning": False, "mechanics": False, "communication": False}
    return {"findings": findings, "strengths": strengths, "assessable": assessable}
