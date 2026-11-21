"""Replay (.replay) analysis pipeline.

Everything comes from parsed data: eliminations/knocks with exact replay time,
end-of-match stats (recording player only), placement, and — when the FRD
adapter could sync world time — positions and storm circles. Analyses that need
images (builds, edits, aim, cover) are reported as not assessable and the coach
is offered the Replay Mode -> video workflow.
"""
from __future__ import annotations

import math
import shutil

from sqlalchemy import select

from ..config import get_settings
from ..db import session_scope
from ..jobs import JobCtx, PipelineError
from ..models import Analysis, Match, MediaFile
from ..replay.base import ReplayError, ReplayParseResult
from ..replay.registry import parse_replay
from ..storage import materialize
from ..vision.provider import get_provider
from . import engine
from .engine import AnalysisContext, Evidence, fmt_t
from .persist import save_analysis

UNIT_TO_M = 0.01  # Unreal units are centimetres


def replay_players(result: ReplayParseResult) -> list[dict]:
    """Candidates for 'which player do you want to analyse'."""
    by_id: dict[str, dict] = {}
    for p in result.players:
        if p.is_bot:
            continue
        by_id[p.id] = {"ref": p.id, "name": p.name, "is_owner": p.is_replay_owner, "team": p.team_index, "placement": p.placement, "kills_reported": p.kills}
    for e in result.eliminations:
        for pid, kind in ((e.eliminator_id, e.eliminator_type), (e.eliminated_id, e.eliminated_type)):
            if pid and kind == "player" and pid not in by_id:
                by_id[pid] = {"ref": pid, "name": None, "is_owner": pid == result.owner_id, "team": None, "placement": None, "kills_reported": None}
    for c in by_id.values():
        c["elims"] = sum(1 for e in result.eliminations if e.eliminator_id == c["ref"] and not e.knocked and e.eliminated_id != c["ref"])
        c["knocks"] = sum(1 for e in result.eliminations if e.eliminator_id == c["ref"] and e.knocked)
        if result.owner_id == c["ref"]:
            c["is_owner"] = True
    return sorted(by_id.values(), key=lambda c: (not c["is_owner"], -(c["elims"]), c["name"] or "~"))


def _zone_at(zones, t_ms):
    cur = None
    for z in zones:
        if z.time_ms is not None and z.time_ms <= t_ms:
            cur = z
    return cur


def build_replay_timeline(r: ReplayParseResult, target: str) -> tuple[list[dict], dict]:
    names = {p.id: p.name for p in r.players if p.name}
    label = lambda pid, kind: "bot" if kind == "bot" else (names.get(pid) or (pid[:8] + "…" if pid else "desconocido"))
    total = r.team_stats.total_players if r.team_stats else None
    alive = total
    events, n = [], 0
    death_t = None
    knocked_times, kill_times, knock_times = [], [], []
    for e in r.eliminations:
        involved = target in (e.eliminator_id, e.eliminated_id)
        if not e.knocked and e.eliminated_id and alive:
            alive -= 1
        if not involved:
            continue
        t = e.time_ms / 1000
        self_inflicted = e.eliminator_id == e.eliminated_id
        if e.eliminated_id == target:
            typ = "player_knocked" if e.knocked else "player_eliminated"
            desc = ("Derribado" if e.knocked else "Eliminado") + ("" if self_inflicted else f" por {label(e.eliminator_id, e.eliminator_type)}") + (" (tormenta/caída/autoinfligido)" if self_inflicted else "")
            if e.knocked:
                knocked_times.append(t)
            else:
                death_t = t
        else:
            typ = "enemy_knocked" if e.knocked else "enemy_eliminated"
            desc = ("Derriba a " if e.knocked else "Elimina a ") + label(e.eliminated_id, e.eliminated_type)
            (knock_times if e.knocked else kill_times).append(t)
        n += 1
        ev = {"id": f"E{n:03d}", "kind": "replay_event", "type": typ, "t": round(t, 2), "description": desc, "players_alive_after": alive if not e.knocked else None}
        if e.eliminated_location:
            ev["location"] = e.eliminated_location
        events.append(ev)

    # positions of the target
    pos = sorted((p for p in r.positions if p.player_id == target), key=lambda p: p.time_ms)
    pos_stats = {}
    if pos:
        dist = 0.0
        for a, b in zip(pos, pos[1:]):
            d = math.dist((a.x, a.y), (b.x, b.y))
            if d < 50000:  # ignore teleports / bus jumps
                dist += d
        pos_stats["distance_travelled_m"] = round(dist * UNIT_TO_M)
        pos_stats["position_samples"] = len(pos)
        # storm relation: sample every 10 s
        if r.safe_zones:
            outside = []
            for p in pos[::10]:
                z = _zone_at(r.safe_zones, p.time_ms)
                if z:
                    d = math.dist((p.x, p.y), (z.x, z.y))
                    outside.append((p.time_ms / 1000, d > z.radius, round((d - z.radius) * UNIT_TO_M)))
            out_moments = [o for o in outside if o[1]]
            pos_stats["samples_outside_next_zone"] = len(out_moments)
            # contiguous outside-zone stretches become evidence events
            stretch = []
            for t, is_out, margin in outside + [(1e9, False, 0)]:
                if is_out:
                    stretch.append((t, margin))
                elif stretch:
                    n += 1
                    events.append({"id": f"E{n:03d}", "kind": "replay_event", "type": "outside_next_zone", "t": round(stretch[0][0], 2),
                                   "t_end": round(stretch[-1][0], 2),
                                   "description": f"Fuera del siguiente círculo seguro ~{len(stretch) * 10}s (máx. {max(m for _, m in stretch)} m del borde)"})
                    stretch = []
        for z in r.safe_zones:
            if z.time_ms is not None and (death_t is None or z.time_ms / 1000 <= death_t):
                n += 1
                near = min(pos, key=lambda p: abs(p.time_ms - z.time_ms))
                d = math.dist((near.x, near.y), (z.x, z.y))
                events.append({"id": f"E{n:03d}", "kind": "replay_event", "type": "zone_shrink_start", "t": round(z.time_ms / 1000, 2),
                               "description": f"Empieza a cerrar zona (radio destino {round(z.radius * UNIT_TO_M)} m). Jugador a {round((d - z.radius) * UNIT_TO_M)} m del borde ({'dentro' if d <= z.radius else 'fuera'})."})
    events.sort(key=lambda e: e["t"])
    for i, e in enumerate(events):  # stable ids in time order
        e["id"] = f"E{i + 1:03d}"

    is_owner = target == r.owner_id
    stats = {
        "source": "replay",
        "replay_length_s": round(r.length_ms / 1000, 1),
        "season": r.version.season_label,
        "eliminations": len(kill_times),
        "knocks": len(knock_times),
        "times_knocked": len(knocked_times),
        "eliminated_at_s": death_t,
        "survival_s": round(death_t if death_t else r.length_ms / 1000, 1),
        "lobby_players": total,
        "placement": (r.team_stats.placement if (r.team_stats and is_owner) else None),
        "recorder_match_stats": (r.match_stats.__dict__ if (r.match_stats and is_owner) else None),
        **pos_stats,
        "note": "Estadísticas finales (precisión, daño, materiales) solo existen para el jugador que grabó la replay.",
    }
    return events, stats


def run_replay_analysis(ctx: JobCtx, match_id: str, owner_id: str) -> str:
    s = get_settings()
    provider = get_provider()
    ok, why = provider.configured()
    if not ok:
        raise PipelineError(f"El análisis con IA no está configurado: {why}", "ai_not_configured")
    with session_scope() as db:
        match = db.get(Match, match_id)
        rep = db.scalar(select(MediaFile).where(MediaFile.match_id == match_id, MediaFile.kind == "replay"))
        if not match or not rep:
            raise PipelineError("La partida no tiene replay subida.", "no_replay")
        key, target = rep.storage_key, match.target_player_ref
        player_label = match.player.name
        context = f"Partida '{match.title}'. Modo: {match.game_mode or match.player.game_mode or 'desconocido'}. Nivel: {match.player.competitive_level or '?'}."
        analysis = Analysis(owner_id=owner_id, match_id=match_id, job_id=ctx.job_id, source_type="replay", is_current=False,
                            model=provider.model, pipeline_version=engine.PIPELINE_VERSION)
        db.add(analysis)
        db.flush()
        analysis_id = analysis.id

    work = s.tmp_dir / f"job-{ctx.job_id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        ctx.progress("Interpretando replay", 5, "Leyendo cabecera y eventos", force=True)
        path = materialize(key, work, "match.replay")
        try:
            r = parse_replay(str(path))
        except ReplayError as e:
            raise PipelineError(f"{e.message} Puedes convertirla a vídeo con el Modo Repetición de Fortnite y subir la grabación.",
                                e.code, match_status="incompatible")
        target = target or r.owner_id
        if not target:
            raise PipelineError("No se pudo identificar automáticamente al jugador de la replay. Selecciónalo en la partida y relanza el análisis.", "target_required", match_status="uploaded")
        events, stats = build_replay_timeline(r, target)
        if not events:
            raise PipelineError("La replay no contiene eventos del jugador seleccionado (ni knocks ni eliminaciones). No hay datos suficientes para un análisis fiable.", "no_events", match_status="incompatible")
        ctx.progress("Construyendo cronología", 25, f"{len(events)} eventos del jugador", force=True)

        actx = AnalysisContext(source_type="replay", provider=provider, player_label=player_label, match_context=context)
        for e in events:
            actx.evidence[e["id"]] = Evidence(e["id"], e["t"], "replay_event", e.get("t_end"))
        length = (stats["eliminated_at_s"] or r.length_ms / 1000)
        actx.analysed_minutes = length / 60
        actx.phase_of = lambda t: "early" if t < length / 3 else "mid" if t < 2 * length / 3 else "end"
        lines = [f"Replay Fortnite {r.version.branch or ''} · duración {fmt_t(r.length_ms / 1000)} · adaptador {r.adapter}",
                 f"Datos NO disponibles: {', '.join(r.unavailable) or 'ninguno'}",
                 f"Estadísticas verificadas: {stats}", "EVENTOS DEL JUGADOR:"]
        lines += [f"{e['id']} {fmt_t(e['t'])}{('-' + fmt_t(e['t_end'])) if e.get('t_end') else ''} {e['type']}: {e['description']}" +
                  (f" (quedan {e['players_alive_after']})" if e.get("players_alive_after") else "") for e in events]
        actx.timeline_text = "\n".join(lines)
        has_pos = bool(stats.get("position_samples"))
        modules = ["fight", "decision", "endgame"]
        if has_pos and r.safe_zones:
            modules += ["rotation", "positioning"]
        else:
            actx.unavailable_modules["rotation"] = "La replay no aporta posiciones/zonas sincronizadas para esta versión."
            actx.unavailable_modules["positioning"] = "Sin posiciones en la replay; usa el Modo Repetición y sube el vídeo."
        actx.unavailable_modules["mechanics"] = "Las mecánicas (builds, edits, aim) solo se pueden evaluar con vídeo."
        actx.unavailable_modules["communication"] = "Las replays no contienen audio de voz."
        actx.available_modules = modules
        ctx.progress("Módulos de coaching", 35, ", ".join(modules), force=True)
        mod = engine.run_modules(actx, [], [], lambda name, x: ctx.progress("Módulos de coaching", 35 + 45 * x, name), provider.concurrency or s.vision_concurrency)
        scores = engine.score(mod["findings"], mod["strengths"], mod["assessable"], actx.analysed_minutes)
        ctx.progress("Redactando informe", 85, force=True)
        report = engine.synthesize_report(actx, mod, scores, stats)
        report["module_summaries"] = mod["module_summaries"]
        report["not_assessable"] = mod["not_assessable"]
        report["strengths_evidence"] = mod["strengths"]
        coverage = {
            "adapter": r.adapter, "adapter_version": r.adapter_version, "version": r.version.__dict__ | {"season_label": r.version.season_label},
            "unavailable": r.unavailable, "warnings": r.warnings, "events": len(events), "target_player_ref": target,
            "dropped_unverified_claims": mod["dropped_unverified"], "analysed_minutes": round(actx.analysed_minutes, 1),
        }
        target_pos = [{"t": round(p.time_ms / 1000, 1), "x": round(p.x), "y": round(p.y)} for p in r.positions if p.player_id == target]
        replay_data = {
            "players": replay_players(r)[:120],
            "positions": target_pos[:: max(1, len(target_pos) // 1500)],
            "zones": [{"t": round(z.time_ms / 1000, 1) if z.time_ms else None, "x": z.x, "y": z.y, "r": z.radius} for z in r.safe_zones],
            "eliminations_total": len(r.eliminations),
        }
        save_analysis(analysis_id, match_id, owner_id, events, stats, scores, report, coverage, mod, actx.usage.as_dict(), replay_data)
        with session_scope() as db:
            db.get(Match, match_id).target_player_ref = target
        ctx.progress("Completado", 100, f"{len(mod['findings'])} errores verificados", force=True)
        return analysis_id
    finally:
        shutil.rmtree(work, ignore_errors=True)
