"""Orquestación de las 6 etapas: ingesta → interpretación → planificación →
ejecución → validación → entrega. Cada etapa actualiza el progreso del trabajo."""
from __future__ import annotations

import json
import logging
import shutil
import traceback
from pathlib import Path

from . import storage
from .ai.client import AIError, get_ai
from .ai.prompts import SYSTEM, document_blocks, interpret_instruction, plan_instruction, review_instruction
from .ai.schemas import Interpretation, Plan, Review
from .config import settings
from .executor import execute_plan, precheck_plan
from .ingest import ingest_file
from .tools import catalog_text
from .validate import validate

log = logging.getLogger("classforge.pipeline")

STAGES = [
    ("ingest", "Ingesta"),
    ("interpret", "Interpretación"),
    ("plan", "Planificación"),
    ("execute", "Ejecución"),
    ("validate", "Validación"),
    ("deliver", "Entrega"),
]


def initial_progress() -> list[dict]:
    return [{"key": k, "label": label, "status": "pending", "detail": "", "started_at": None, "finished_at": None} for k, label in STAGES]


def set_stage(job_id: str, key: str, status: str, detail: str = "") -> None:
    def fn(job):
        job["stage"] = key
        for s in job["progress"]:
            if s["key"] == key:
                s["status"] = status
                s["detail"] = detail
                if status == "running":
                    s["started_at"] = storage.now_iso()
                    s["finished_at"] = None
                elif status in ("done", "error", "skipped"):
                    s["finished_at"] = storage.now_iso()
    storage.update_job(job_id, fn)


def reset_stages(job_id: str, keys: list[str]) -> None:
    def fn(job):
        for s in job["progress"]:
            if s["key"] in keys:
                s.update(status="pending", detail="", started_at=None, finished_at=None)
    storage.update_job(job_id, fn)


def _fail(job_id: str, stage: str, message: str, status: str = "failed") -> None:
    set_stage(job_id, stage, "error", message)

    def fn(job):
        job["status"] = status
        job["error"] = message
    storage.update_job(job_id, fn)


def _inputs(job: dict) -> dict[str, dict]:
    d = storage.job_dir(job["id"]) / "inputs"
    return {f["id"]: {"path": str(d / f["stored_name"]), "kind": f["kind"], "name": f["name"]} for f in job["files"]}


# --------------------------------------------------------------------------- #
# Etapa 1
# --------------------------------------------------------------------------- #
def run_ingest(job_id: str) -> None:
    set_stage(job_id, "ingest", "running", "Leyendo documentos…")
    job = storage.load_job(job_id)
    jd = storage.job_dir(job_id)
    records, flags = [], []
    for f in job["files"]:
        rec = ingest_file(jd / "inputs" / f["stored_name"], f, jd / "work")
        records.append(rec)
        flags.extend(rec["flags"])
    storage.write_json(job_id, "ingest.json", records)

    def fn(j):
        j["security_flags"] = flags
        for f in j["files"]:
            rec = next(r for r in records if r["file_id"] == f["id"])
            f["ingest"] = {"ok": rec["ok"], "error": rec["error"], "chars": len(rec["text"]), "images": len(rec["images"]),
                           "truncated": rec["truncated"], "summary": _summary(rec)}
    storage.update_job(job_id, fn)
    bad = [r for r in records if not r["ok"]]
    if bad and len(bad) == len(records):
        _fail(job_id, "ingest", "No se pudo leer ningún documento.")
        return
    detail = f"{len(records) - len(bad)} documento(s) leído(s)" + (f", {len(bad)} con errores" if bad else "")
    set_stage(job_id, "ingest", "done", detail)


def _summary(rec: dict) -> str:
    s = rec.get("structure", {})
    k = rec["kind"]
    if not rec["ok"]:
        return "Error de lectura"
    if k == "docx":
        return f"{s.get('paragraphs', 0)} párrafos · {s.get('tables', 0)} tablas" + (f" · {len(s.get('placeholders', []))} huecos" if s.get("placeholders") else "")
    if k == "xlsx":
        sh = s.get("sheets", [])
        return f"{len(sh)} hoja(s): " + ", ".join(x["name"] for x in sh[:4]) + (f" · {sum(x['formulas'] for x in sh)} fórmulas" if sh else "")
    if k == "pptx":
        return f"{len(s.get('slides', []))} diapositivas"
    if k == "pdf":
        return f"{s.get('pages', 0)} página(s)"
    if k == "csv":
        return f"{s.get('rows', 0)} filas"
    if k == "image":
        return f"{s.get('width')}×{s.get('height')} px · análisis con visión"
    return f"{s.get('chars', 0)} caracteres"


# --------------------------------------------------------------------------- #
# Etapa 2
# --------------------------------------------------------------------------- #
def run_analysis(job_id: str) -> None:
    try:
        _run_analysis(job_id)
    except Exception as e:  # noqa: BLE001
        log.error("analysis failed: %s", traceback.format_exc())
        _fail(job_id, "interpret", f"Error inesperado en el análisis: {type(e).__name__}")


def _run_analysis(job_id: str) -> None:
    job = storage.load_job(job_id)
    records = storage.read_json(job_id, "ingest.json") or []
    set_stage(job_id, "interpret", "running", "Claude está leyendo las instrucciones…")
    content = document_blocks(records, storage.job_dir(job_id) / "work")
    content.append({"type": "text", "text": interpret_instruction(job["student_name"], job["date"], job.get("extra_notes", ""))})
    try:
        interp: Interpretation = get_ai().structured(system=SYSTEM, content=content, schema=Interpretation, max_tokens=32000)
    except AIError as e:
        _fail(job_id, "interpret", str(e))
        return
    data = interp.model_dump()
    files = {f["id"]: f for f in job["files"]}
    for d in data["deliverables"]:
        if d["base_file_id"] and d["base_file_id"] not in files:
            d["base_file_id"] = None
    ai_flags = [{"source": "Análisis de la IA", "reason": "Instrucción sospechosa detectada", "snippet": s} for s in data["suspicious_instructions"]]

    def fn(j):
        j["analysis"] = data
        j["title"] = data["title"] or j.get("title")
        j["security_flags"] = j.get("security_flags", []) + ai_flags
        j["status"] = "analyzed"
        j["error"] = None
    storage.update_job(job_id, fn)
    set_stage(job_id, "interpret", "done", f"{len(data['exercises'])} ejercicio(s), {len(data['requirements'])} requisito(s), {len(data['deliverables'])} entregable(s)")


# --------------------------------------------------------------------------- #
# Etapas 3-6
# --------------------------------------------------------------------------- #
def format_conflicts(analysis: dict, format_pref: str) -> list[str]:
    if not format_pref or format_pref == "auto":
        return []
    out = []
    for d in analysis.get("deliverables", []):
        if d["format"] != format_pref and d.get("format_explicitly_required"):
            out.append(f"El profesor pide «{d['filename']}» en {d['format'].upper()}, pero has elegido {format_pref.upper()}. "
                       f"Se generará el formato exigido y, además, una versión en {format_pref.upper()} si es posible.")
    return out


def run_generation(job_id: str, format_pref: str = "auto", extra_notes: str = "", feedback: str | None = None) -> None:
    try:
        _run_generation(job_id, format_pref, extra_notes, feedback)
    except Exception as e:  # noqa: BLE001
        log.error("generation failed: %s", traceback.format_exc())
        job = storage.load_job(job_id)
        _fail(job_id, job.get("stage") or "execute", f"Error inesperado: {type(e).__name__}: {e}")


def _run_generation(job_id: str, format_pref: str, extra_notes: str, feedback: str | None) -> None:
    job = storage.load_job(job_id)
    analysis = job["analysis"]
    records = storage.read_json(job_id, "ingest.json") or []
    jd = storage.job_dir(job_id)
    inputs = _inputs(job)
    structures = {r["file_id"]: r["structure"] for r in records}
    version = len(job["versions"]) + 1
    warnings = format_conflicts(analysis, format_pref)

    # ---- Etapa 3: planificación
    set_stage(job_id, "plan", "running", "Claude está preparando el plan de operaciones…" if not feedback else "Aplicando tu corrección…")
    revision = None
    if feedback:
        prev = job["versions"][-1] if job["versions"] else None
        revision = {
            "feedback": feedback,
            "previous_plan_summary": _plan_summary(prev.get("plan")) if prev else None,
            "previous_problems": prev["validation"]["problems"] if prev else [],
        }
    content = document_blocks(records, jd / "work")
    instr = plan_instruction(interpretation=analysis, catalog=catalog_text(), files=[{"id": f["id"], "name": f["name"], "kind": f["kind"]} for f in job["files"]],
                             student=job["student_name"], date=job["date"], format_pref=format_pref, extra_notes=extra_notes, revision=revision)
    ai = get_ai()
    try:
        plan: Plan = ai.structured(system=SYSTEM, content=content + [{"type": "text", "text": instr}], schema=Plan)
        errors = precheck_plan(plan, inputs)
        if errors:
            set_stage(job_id, "plan", "running", f"Corrigiendo {len(errors)} problema(s) del plan…")
            fix = (instr + "\n\nTU PLAN ANTERIOR NO SUPERÓ LA VALIDACIÓN DEL SERVIDOR. Errores:\n- " + "\n- ".join(errors[:40]) +
                   "\n\nPlan anterior:\n" + plan.model_dump_json()[:60000] + "\n\nDevuelve el plan COMPLETO corregido.")
            plan = ai.structured(system=SYSTEM, content=content + [{"type": "text", "text": fix}], schema=Plan)
            errors = precheck_plan(plan, inputs)
    except AIError as e:
        _fail(job_id, "plan", str(e), status="analyzed_error")
        return
    if errors:
        warnings.append(f"El plan tenía {len(errors)} operación(es) no válidas que no se ejecutarán.")
    n_ops = sum(len(d.ops) for d in plan.deliverables)
    set_stage(job_id, "plan", "done", f"{len(plan.deliverables)} entregable(s), {n_ops} operaciones")

    # ---- Etapa 4: ejecución
    set_stage(job_id, "execute", "running", "Generando archivos…")
    vdir = jd / "outputs" / f"v{version}"
    if vdir.exists():
        shutil.rmtree(vdir)
    results = execute_plan(plan, inputs=inputs, structures=structures, out_dir=vdir, work_dir=jd / "work" / f"v{version}",
                           student_name=job["student_name"], date=job["date"])
    failed_ops = sum(1 for r in results for s in r.steps if s["status"] != "ok")
    set_stage(job_id, "execute", "done", f"{sum(1 for r in results if r.ok)} archivo(s) generados" + (f", {failed_ops} operación(es) fallidas" if failed_ops else ""))

    # ---- Etapa 5: validación
    set_stage(job_id, "validate", "running", "Reabriendo y comprobando los archivos…")
    report = validate(results, interpretation=analysis, plan_unresolved=[u.model_dump() for u in plan.unresolved],
                      structures=structures, work_dir=jd / "work" / f"v{version}" / "validate")
    review = None
    if settings.ai_review and any(r.ok for r in results):
        set_stage(job_id, "validate", "running", "Claude está revisando el resultado frente a los requisitos…")
        review = _ai_review(job_id, analysis, results, report, content)
        if review is not None:
            mandatory = {r["id"] for r in analysis.get("requirements", []) if r.get("mandatory")}
            for it in review["items"]:
                if it["requirement_id"] in mandatory and it["status"] != "hecho":
                    report["problems"].append(f"Revisión IA: el requisito {it['requirement_id']} está {it['status']}: {it['comment']}")
    set_stage(job_id, "validate", "done" if not report["problems"] else "error",
              "Todo verificado" if not report["problems"] else f"{len(report['problems'])} aspecto(s) a revisar")

    # ---- Etapa 6: entrega
    outputs = []
    for r in results:
        if r.ok and r.path and r.path.exists():
            vrep = next(d for d in report["deliverables"] if d["id"] == r.id)
            outputs.append({"id": storage.new_file_id(), "deliverable_id": r.id, "name": r.filename, "format": r.format,
                            "size": r.path.stat().st_size, "stored": str(r.path.relative_to(jd)),
                            "recalculated": str(Path(vrep["recalculated"]).relative_to(jd)) if vrep.get("recalculated") else None,
                            "purpose": r.purpose})
    status = "completed" if outputs and not report["problems"] else ("needs_review" if outputs else "failed")
    record = {
        "version": version, "created_at": storage.now_iso(), "feedback": feedback, "format_pref": format_pref,
        "status": status, "outputs": outputs, "warnings": warnings + [w for r in results for w in r.warnings],
        "deliverables": [{"id": r.id, "filename": r.filename, "format": r.format, "ok": r.ok, "error": r.error, "purpose": r.purpose,
                          "base_file_id": r.base_file_id, "steps": r.steps} for r in results],
        "validation": report, "review": review, "plan": plan.model_dump(),
    }

    def fn(j):
        j["versions"].append(record)
        j["plan"] = record["plan"]
        j["status"] = status
        j["error"] = None if outputs else "No se generó ningún archivo."
    storage.update_job(job_id, fn)
    set_stage(job_id, "deliver", "done" if outputs else "error", f"{len(outputs)} archivo(s) listos para descargar" if outputs else "Sin archivos")


def _plan_summary(plan: dict | None) -> list[dict] | None:
    if not plan:
        return None
    return [{"id": d["id"], "filename": d["filename"], "format": d["format"], "base_file_id": d["base_file_id"],
             "ops": [{"op": o["op"], "args_json": o["args_json"][:600], "covers": o["covers"]} for o in d["ops"]]} for d in plan["deliverables"]]


def _ai_review(job_id: str, analysis: dict, results, report: dict, content: list[dict]) -> dict | None:
    from .ingest.office import ingest_docx, ingest_pptx, ingest_xlsx
    from .ingest.other import ingest_csv, ingest_pdf

    fns = {"docx": ingest_docx, "xlsx": ingest_xlsx, "pptx": ingest_pptx, "pdf": ingest_pdf, "csv": ingest_csv}
    texts = []
    for r in results:
        if not r.ok or not r.path:
            continue
        vrep = next(d for d in report["deliverables"] if d["id"] == r.id)
        path = Path(vrep["recalculated"]) if vrep.get("recalculated") else r.path
        try:
            t = fns[r.format](path)["text"]
        except Exception as e:  # noqa: BLE001
            t = f"(no se pudo extraer: {e})"
        texts.append({"name": r.filename, "text": t[: settings.max_chars_per_doc]})
    try:
        rev: Review = get_ai().structured(system=SYSTEM, content=content + [{"type": "text", "text": review_instruction(analysis, texts)}], schema=Review, max_tokens=16000)
    except AIError as e:
        report.setdefault("notes", []).append(f"No se pudo realizar la revisión con IA: {e}")
        return None
    return rev.model_dump()
