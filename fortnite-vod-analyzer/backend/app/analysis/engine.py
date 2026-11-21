"""Shared analysis logic: evidence registry, module runs, validation,
de-duplication, phases, scoring and report synthesis."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable

from ..vision.provider import Part, ProviderError, Usage, VisionProvider
from . import prompts
from .schemas import CATEGORY_LABELS, MODULE_SCHEMA, REPORT_SCHEMA
from .scoring import SEVERITY_WEIGHTS, compute_scores

PIPELINE_VERSION = "1.0.0"

MODULE_CATEGORIES = {
    "positioning": {"positioning", "survival"},
    "rotation": {"rotation"},
    "fight": {"fight", "mechanics"},
    "endgame": {"endgame", "materials", "healing"},
    "decision": {"decision", "fight", "rotation", "positioning", "survival"},
    "mechanics": {"mechanics"},
    "communication": {"communication"},
}
MODULE_SITUATIONS = {
    "positioning": {"fighting", "idle_or_holding", "rotating", "building"},
    "rotation": {"rotating", "in_storm"},
    "fight": {"fighting", "building", "editing", "downed"},
    "endgame": {"fighting", "rotating", "building", "healing", "victory", "in_storm"},
    "decision": {"fighting", "rotating", "healing", "in_storm", "downed", "eliminated"},
    "mechanics": {"building", "editing", "fighting"},
    "communication": set(),
}


def fmt_t(t: float) -> str:
    t = max(0.0, float(t))
    m, s = divmod(t, 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{int(h)}:{int(m):02d}:{s:04.1f}"
    return f"{int(m):02d}:{s:04.1f}"


@dataclass
class Evidence:
    id: str
    t: float
    kind: str  # frame|replay_event|speech
    t_end: float | None = None


@dataclass
class AnalysisContext:
    source_type: str
    provider: VisionProvider
    player_label: str
    match_context: str
    evidence: dict[str, Evidence] = field(default_factory=dict)
    timeline_text: str = ""
    frame_loader: Callable[[str], bytes] | None = None  # label -> jpeg
    frame_items: list[dict] = field(default_factory=list)  # timeline frame items
    usage: Usage = field(default_factory=Usage)
    analysed_minutes: float = 0.0
    phase_of: Callable[[float], str] | None = None
    has_transcript: bool = False
    available_modules: list[str] = field(default_factory=list)
    unavailable_modules: dict[str, str] = field(default_factory=dict)


def select_key_frames(ctx: AnalysisContext, module: str, observations: list[dict], events: list[dict], limit: int = 16) -> list[str]:
    cats = MODULE_CATEGORIES[module]
    picked: list[str] = []
    for o in observations:
        if o["category"] in cats and o["kind"] == "mistake":
            picked += o["frames"]
    for o in observations:
        if o["category"] in cats and o["kind"] != "mistake":
            picked += o["frames"]
    for e in events:
        if module in ("fight", "decision", "mechanics") and e["type"] in ("fight_start", "player_knocked", "player_eliminated", "build_fight", "edit_play", "third_party"):
            picked += e["evidence"]
        if module in ("rotation", "positioning") and e["type"] in ("rotation_start", "storm_damage", "took_damage"):
            picked += e["evidence"]
    sits = MODULE_SITUATIONS[module]
    picked += [f["id"] for f in ctx.frame_items if f.get("situation") in sits]
    if module == "endgame":
        picked += [f["id"] for f in ctx.frame_items if f.get("phase") == "end"]
    seen, out = set(), []
    for p in picked:
        if p in ctx.evidence and ctx.evidence[p].kind == "frame" and p not in seen:
            seen.add(p)
            out.append(p)
    if len(out) > limit:
        # keep the first (highest priority) half, spread the rest in time
        head = out[: limit // 2]
        rest = sorted(out[limit // 2 :], key=lambda x: ctx.evidence[x].t)
        step = len(rest) / (limit - len(head))
        out = head + [rest[int(i * step)] for i in range(limit - len(head))]
    return sorted(out, key=lambda x: ctx.evidence[x].t)


def run_module(ctx: AnalysisContext, module: str, key_frames: list[str]) -> dict:
    system = prompts.MODULE_SYSTEM + ("\n" + prompts.REPLAY_SYSTEM_SUFFIX if ctx.source_type == "replay" else "")
    parts = [
        Part.t(prompts.MODULE_RUBRICS[module]),
        Part.t(f"JUGADOR ANALIZADO: {ctx.player_label}\nCONTEXTO: {ctx.match_context}"),
        Part.t("CRONOLOGÍA VERIFICADA:\n" + ctx.timeline_text),
    ]
    if key_frames and ctx.frame_loader:
        parts.append(Part.t("FOTOGRAMAS CLAVE PARA ESTE MÓDULO (cada imagen va precedida de su id y tiempo):"))
        for label in key_frames:
            parts.append(Part.t(f"{label} @ {fmt_t(ctx.evidence[label].t)}"))
            parts.append(Part.img(ctx.frame_loader(label)))
    parts.append(Part.t("Devuelve el JSON del módulo. Recuerda: evidencia obligatoria con ids existentes."))
    data, usage = ctx.provider.complete_json(system, parts, MODULE_SCHEMA)
    ctx.usage.add(usage)
    return data


def validate_findings(ctx: AnalysisContext, module: str, data: dict) -> tuple[list[dict], list[dict], int]:
    """Keep only findings whose evidence ids exist. Returns (findings, strengths, dropped)."""
    out, dropped = [], 0
    for f in data.get("findings", []):
        ev = [e for e in dict.fromkeys(f.get("evidence", [])) if e in ctx.evidence]
        if not ev:
            dropped += 1
            continue
        times = sorted(ctx.evidence[e].t for e in ev)
        ends = [ctx.evidence[e].t_end or ctx.evidence[e].t for e in ev]
        conf = max(0.0, min(1.0, float(f.get("confidence", 0.6))))
        out.append(
            {
                "module": module,
                "category": f["category"],
                "error_type": f["error_type"],
                "severity": f["severity"],
                "t_start": round(times[0], 2),
                "t_end": round(max(ends), 2) if max(ends) > times[0] else None,
                "title": f["title"].strip()[:200],
                "what_happened": f["what_happened"].strip(),
                "why_error": f["why_error"].strip(),
                "what_to_do": f["what_to_do"].strip(),
                "how_to_avoid": f["how_to_avoid"].strip(),
                "evidence": [{"id": e, "t": round(ctx.evidence[e].t, 2), "kind": ctx.evidence[e].kind} for e in ev],
                "confidence": round(conf, 2),
                "phase": ctx.phase_of(times[0]) if ctx.phase_of else None,
            }
        )
    strengths = []
    for s in data.get("strengths", []):
        ev = [e for e in s.get("evidence", []) if e in ctx.evidence]
        if ev:
            strengths.append({"module": module, "description": s["description"], "evidence": ev, "t": ctx.evidence[ev[0]].t})
        else:
            dropped += 1
    return out, strengths, dropped


def dedupe(findings: list[dict]) -> list[dict]:
    def weight(f):
        return SEVERITY_WEIGHTS[f["severity"]] * (0.5 + 0.5 * f["confidence"])

    kept: list[dict] = []
    for f in sorted(findings, key=weight, reverse=True):
        ev = {e["id"] for e in f["evidence"]}
        dup = False
        for k in kept:
            kev = {e["id"] for e in k["evidence"]}
            same_cat = k["category"] == f["category"] or k["error_type"] == f["error_type"]
            if same_cat and (abs(k["t_start"] - f["t_start"]) <= 4 or len(ev & kev) >= max(1, min(len(ev), len(kev)) // 2 + 1)):
                dup = True
                # merge evidence into the stronger finding
                k["evidence"] = sorted({e["id"]: e for e in k["evidence"] + f["evidence"]}.values(), key=lambda e: e["t"])
                break
        if not dup:
            kept.append(f)
    return sorted(kept, key=lambda f: f["t_start"])


def run_modules(ctx: AnalysisContext, observations: list[dict], events: list[dict], progress: Callable[[str, float], None], concurrency: int = 3) -> dict:
    results: dict[str, dict] = {}
    modules = ctx.available_modules

    def one(m: str):
        key = select_key_frames(ctx, m, observations, events, limit=min(16, ctx.provider.max_images)) if ctx.source_type == "video" else []
        last_err = None
        for _attempt in range(2):
            try:
                return m, run_module(ctx, m, key), None
            except ProviderError as e:
                last_err = e
                if not e.retryable:
                    break
        return m, None, last_err

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        for m, data, err in pool.map(one, modules):
            done += 1
            progress(f"Módulo {m}", done / max(1, len(modules)))
            if err:
                if err.code in ("ai_auth", "ai_model", "ai_permission"):
                    raise err
                results[m] = {"error": err.message}
            else:
                results[m] = data
    all_findings, strengths, assessable, summaries, not_assessable, dropped = [], [], {}, {}, {}, 0
    for m, data in results.items():
        if "error" in data:
            assessable[m] = False
            not_assessable[m] = [f"El módulo falló: {data['error']}"]
            continue
        f, s, d = validate_findings(ctx, m, data)
        dropped += d
        all_findings += f
        strengths += s
        assessable[m] = bool(data.get("assessable")) or bool(f)
        summaries[m] = data.get("summary", "")
        not_assessable[m] = data.get("not_assessable", [])
    for m, reason in ctx.unavailable_modules.items():
        assessable[m] = False
        not_assessable[m] = [reason]
    return {
        "findings": dedupe(all_findings),
        "strengths": strengths,
        "assessable": assessable,
        "module_summaries": summaries,
        "not_assessable": not_assessable,
        "dropped_unverified": dropped,
    }


def strengths_by_category(strengths: list[dict]) -> dict[str, int]:
    # Each module's strengths count toward the category of the same name.
    out: dict[str, int] = {}
    for s in strengths:
        out[s["module"]] = out.get(s["module"], 0) + 1
    return out


def finding_weight(f: dict) -> float:
    return SEVERITY_WEIGHTS[f["severity"]] * (0.5 + 0.5 * float(f.get("confidence") or 0.6))


def top_findings(findings: list[dict], n: int = 5) -> list[dict]:
    live = [f for f in findings if f.get("review_status") != "dismissed"]
    return sorted(live, key=finding_weight, reverse=True)[:n]


def score(findings: list[dict], strengths: list[dict], assessable: dict, minutes: float) -> dict:
    out = compute_scores(findings, strengths_by_category(strengths), assessable, minutes)
    out["inputs"] = {"assessable": assessable, "strengths": strengths_by_category(strengths)}
    return out


def rescore(previous: dict, findings: list[dict]) -> dict:
    """Recompute after the coach confirms/dismisses/adds findings."""
    inp = previous.get("inputs", {})
    out = compute_scores(findings, inp.get("strengths", {}), inp.get("assessable", {}), previous.get("analysed_minutes", 0))
    out["inputs"] = inp
    return out


def synthesize_report(ctx: AnalysisContext, mod: dict, scores: dict, stats: dict) -> dict:
    findings = mod["findings"]
    ref = {f"H{i + 1:03d}": f for i, f in enumerate(findings)}
    lines = []
    for hid, f in ref.items():
        lines.append(
            f"{hid} {fmt_t(f['t_start'])} [{f['phase'] or '?'}] {CATEGORY_LABELS[f['category']]} / {f['error_type']} / {f['severity']} (conf {f['confidence']}): "
            f"{f['title']} — {f['what_happened']} | Por qué: {f['why_error']} | Debió: {f['what_to_do']}"
        )
    top = top_findings(findings)
    top_ids = [hid for hid, f in ref.items() if f in top]
    strengths_txt = "\n".join(f"- [{s['module']}] {fmt_t(s['t'])}: {s['description']}" for s in mod["strengths"]) or "(ninguno con evidencia)"
    na_txt = "\n".join(f"- {m}: {'; '.join(v)}" for m, v in mod["not_assessable"].items() if v) or "(nada)"
    sc_txt = json.dumps({k: v["score"] for k, v in scores["categories"].items()}, ensure_ascii=False)
    parts = [
        Part.t(f"JUGADOR: {ctx.player_label}\nCONTEXTO: {ctx.match_context}\nESTADÍSTICAS VERIFICADAS: {json.dumps(stats, ensure_ascii=False)}"),
        Part.t("RESUMEN POR MÓDULO:\n" + "\n".join(f"- {m}: {s}" for m, s in mod["module_summaries"].items())),
        Part.t("HALLAZGOS VERIFICADOS:\n" + ("\n".join(lines) or "(sin errores verificados)")),
        Part.t(f"TOP 5 (ya ordenado por gravedad×confianza, comenta cada uno usando su id en finding_ref): {', '.join(top_ids) or 'ninguno'}"),
        Part.t("ACIERTOS CON EVIDENCIA:\n" + strengths_txt),
        Part.t("NO EVALUABLE:\n" + na_txt),
        Part.t(f"PUNTUACIONES (orientativas, metodología propia): global {scores['overall']} · {sc_txt}"),
        Part.t("CRONOLOGÍA (referencia):\n" + ctx.timeline_text[:60000]),
    ]
    system = prompts.REPORT_SYSTEM + ("\n" + prompts.REPLAY_SYSTEM_SUFFIX if ctx.source_type == "replay" else "")
    data, usage = ctx.provider.complete_json(system, parts, REPORT_SCHEMA)
    ctx.usage.add(usage)
    data["top_errors"] = [
        {"ref": hid, "finding_index": findings.index(ref[hid]), "comment": next((c["comment"] for c in data.get("top_errors_commentary", []) if c["finding_ref"] == hid), "")}
        for hid in top_ids
    ]
    return data
