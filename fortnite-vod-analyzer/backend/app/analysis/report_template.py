"""Coaching report built from measured data and rule findings (no generative AI).
Same structure as the AI report so the UI and PDF work unchanged."""
from __future__ import annotations

from .engine import fmt_t, top_findings
from .schemas import CATEGORY_LABELS

DRILLS = {
    "rotation": ("Zone Wars (mapas creativos)", "Rotar a tiempo y entrar en zona con cobertura", "4–6 rondas centradas en rotar al anuncio de cada zona; prohibido lootear con menos de 30 s de cierre.", 25),
    "decision": ("Box fights con regla de recursos", "Elegir cuándo pelear", "Solo se permite iniciar con ≥150 de vida+escudo; si no, curar o desengancharse. Revisar cada ronda.", 20),
    "healing": ("Rutina post-pelea", "Curarse antes de lootear", "Tras cada kill en box fights: box → curación → mats → loot, cronometrando < 10 s.", 15),
    "materials": ("Farm por objetivos", "Llegar al endgame con mats", "Partidas públicas con objetivo: 500 mats al primer cierre y 999 en top 25; anotar en cada partida.", 30),
    "fight": ("Piece control 1v1", "Ganar intercambios cerrados", "1v1 en mapas de piece control, 15 min, revisando dónde se pierde la altura.", 15),
    "endgame": ("Endgame simulators", "Sobrevivir en zonas móviles", "Mapas de endgame con zonas móviles; objetivo: llegar a la última zona con ≥500 mats.", 25),
    "survival": ("Revisión de muertes", "Entender cada eliminación", "Tras cada partida, revisar en replay los 20 s previos a la eliminación.", 10),
}

GOALS = {
    "rotation": ("0 segundos en tormenta", "0 s de tormenta en 3 de las próximas 5 partidas"),
    "decision": ("Pelear con recursos", "Iniciar ≥ 80 % de las peleas con ≥150 de vida+escudo"),
    "healing": ("Curarse tras cada pelea", "Vida+escudo ≥ 150 en menos de 30 s tras cada pelea"),
    "materials": ("Mats para el endgame", "Llegar a top 25 con ≥ 500 materiales"),
    "fight": ("Ganar más intercambios", "Ratio de knocks recibidos/hechos < 1"),
    "endgame": ("Endgame más largo", "Llegar a las 3 últimas zonas en 2 de 5 partidas"),
    "survival": ("Menos muertes evitables", "0 muertes por tormenta o caída"),
}


def build_report(source: str, findings: list[dict], strengths: list[dict], stats: dict, scores: dict, phase_of, not_assessable: dict) -> dict:
    tops = top_findings(findings)
    cats = {}
    for f in findings:
        cats[f["category"]] = cats.get(f["category"], 0) + 1
    worst = sorted(cats.items(), key=lambda x: -x[1])

    if source == "video":
        summary = (f"Vídeo de {fmt_t(stats.get('duration_s', 0))}. Se leyeron {stats.get('hud_samples', 0)} muestras del HUD "
                   f"({stats.get('hud_legible_pct', 0)} % con vida legible) y se detectaron {stats.get('fights_detected', 0)} momentos de pelea por audio/imagen. "
                   + (f"Tiempo en tormenta detectado: {stats.get('storm_seconds', 0)} s. " if stats.get("storm_seconds") else "")
                   + (f"Mínimo de jugadores restantes leído: {stats['players_remaining_min']}. " if stats.get("players_remaining_min") else ""))
    else:
        summary = (f"Replay de {fmt_t(stats.get('replay_length_s', 0))} (Fortnite {stats.get('season') or '?'}). "
                   f"{stats.get('eliminations', 0)} eliminaciones y {stats.get('knocks', 0)} knocks propios; derribado {stats.get('times_knocked', 0)} veces. "
                   + (f"Eliminado en {fmt_t(stats['eliminated_at_s'])}. " if stats.get("eliminated_at_s") else "Sin eliminación registrada. ")
                   + (f"Puesto final: {stats['placement']} de {stats.get('lobby_players') or '?'}." if stats.get("placement") else ""))

    overall = scores.get("overall")
    if not findings:
        evaluation = "Las reglas automáticas no han detectado errores con los datos disponibles. Eso no significa que no los haya: posicionamiento, mecánicas y decisiones complejas necesitan revisión visual del coach."
    else:
        evaluation = (f"Puntuación orientativa {overall if overall is not None else '—'}/100. Áreas con más incidencias: "
                      + ", ".join(f"{CATEGORY_LABELS.get(c, c)} ({n})" for c, n in worst[:3]) + ". "
                      "Análisis automático por reglas: revisa cada error en su fotograma o evento y confírmalo o descártalo.")

    def phase_text(ph: str) -> str:
        fs = [f for f in findings if f.get("phase") == ph]
        if not fs:
            return "Sin incidencias detectadas por las reglas en esta fase."
        return " ".join(f"{fmt_t(f['t_start'])} — {f['title']}." for f in fs[:6])

    fights_txt = [f for f in findings if f["category"] in ("decision", "fight", "healing")]
    fight_strengths = [s for s in strengths if s["module"] in ("fight", "decision")]
    fights = (" ".join(f"{fmt_t(f['t_start'])} — {f['title']}." for f in fights_txt[:6]) or "Sin errores de pelea detectados por las reglas.") + (
        f" Aciertos: {len(fight_strengths)} (p. ej. {fight_strengths[0]['description']})" if fight_strengths else "")

    recs, drills, goals, seen = [], [], [], set()
    for c, _n in worst:
        if c in seen:
            continue
        seen.add(c)
        example = next(f for f in findings if f["category"] == c)
        recs.append({"title": CATEGORY_LABELS.get(c, c), "detail": example["what_to_do"], "category": c})
        if c in DRILLS:
            n, g, h, m = DRILLS[c]
            drills.append({"name": n, "goal": g, "how": h, "duration_minutes": m, "category": c})
        if c in GOALS:
            t, mt = GOALS[c]
            goals.append({"title": t, "measurable_target": mt, "category": c})
    if not drills:
        n, g, h, m = DRILLS["survival"]
        drills.append({"name": n, "goal": g, "how": h, "duration_minutes": m, "category": "survival"})

    limitations = ["Informe generado por reglas automáticas a partir de datos medidos (sin IA generativa)."]
    if source == "video":
        limitations.append("Posicionamiento, altura, cobertura, builds, edits y aim no se evalúan sin un modelo de visión; quedan para la revisión del coach en el VOD.")
        if not stats.get("hud_calibrated"):
            limitations.append("El HUD de este jugador no está calibrado: las lecturas usan posiciones aproximadas y pueden fallar. Calíbralo en su perfil.")
    return {
        "match_summary": summary.strip(),
        "overall_evaluation": evaluation,
        "strengths": [s["description"] for s in strengths[:8]],
        "weaknesses": [f"{f['title']} ({fmt_t(f['t_start'])})" for f in tops],
        "top_errors_commentary": [],
        "top_errors": [{"ref": f"H{findings.index(f) + 1:03d}", "finding_index": findings.index(f), "comment": ""} for f in tops],
        "early_game": phase_text("early"),
        "mid_game": phase_text("mid"),
        "endgame": phase_text("end"),
        "fights": fights,
        "recommendations": recs,
        "drills": drills,
        "next_session_goals": goals,
        "limitations": limitations,
        "generated_by": "rules",
    }
