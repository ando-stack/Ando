"""Etapa 4: EJECUCIÓN. Traduce el plan validado a llamadas a las funciones
documentales controladas del backend. Nunca ejecuta código de la IA."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from .ai.schemas import Plan
from .config import settings
from .storage import safe_filename
from .tools import REGISTRY, FORMATS
from .tools.base import ExecContext, OpError, parse_args

EXT = {"docx": "docx", "xlsx": "xlsx", "pptx": "pptx", "pdf": "pdf", "csv": "csv"}
BASE_KINDS = {"docx": {"docx"}, "xlsx": {"xlsx"}, "pptx": {"pptx"}, "pdf": {"pdf"}, "csv": {"csv"}}


@dataclass
class DeliverableResult:
    id: str
    filename: str
    format: str
    path: Path | None
    base_file_id: str | None
    purpose: str
    ok: bool
    error: str | None
    steps: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checks: list = field(default_factory=list)
    deleted: dict = field(default_factory=dict)


def precheck_plan(plan: Plan, inputs: dict[str, dict]) -> list[str]:
    """Valida el plan ANTES de ejecutar nada: operaciones existentes, formato y argumentos."""
    errors: list[str] = []
    total = sum(len(d.ops) for d in plan.deliverables)
    if total > settings.max_ops_per_plan:
        errors.append(f"El plan tiene {total} operaciones; el máximo es {settings.max_ops_per_plan}.")
    ids = set()
    for d in plan.deliverables:
        if d.id in ids:
            errors.append(f"Id de entregable duplicado: {d.id}")
        ids.add(d.id)
        if d.base_file_id and d.base_file_id not in inputs:
            errors.append(f"{d.id}: base_file_id «{d.base_file_id}» no existe.")
        elif d.base_file_id and inputs[d.base_file_id]["kind"] not in BASE_KINDS[d.format]:
            errors.append(f"{d.id}: la plantilla «{inputs[d.base_file_id]['name']}» no es de formato {d.format}.")
        for i, op in enumerate(d.ops):
            spec = REGISTRY.get(op.op)
            where = f"{d.id} op#{i + 1} ({op.op})"
            if spec is None:
                errors.append(f"{where}: operación inexistente.")
                continue
            if spec.fmt != d.format:
                errors.append(f"{where}: es de formato {spec.fmt} pero el entregable es {d.format}.")
                continue
            try:
                raw = json.loads(op.args_json or "{}")
                spec.args_model.model_validate(raw)
            except json.JSONDecodeError as e:
                errors.append(f"{where}: args_json no es JSON válido ({e.msg}).")
            except ValidationError as e:
                msgs = "; ".join(f"{'.'.join(str(x) for x in er['loc'])}: {er['msg']}" for er in e.errors()[:4])
                errors.append(f"{where}: {msgs}")
    return errors


def execute_plan(plan: Plan, *, inputs: dict[str, dict], structures: dict[str, dict], out_dir: Path, work_dir: Path,
                 student_name: str, date: str) -> list[DeliverableResult]:
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    results: list[DeliverableResult] = []
    produced: dict[str, Path] = {}
    used_names: set[str] = set()
    budget = settings.max_ops_per_plan

    for d in plan.deliverables:
        name = safe_filename(d.filename, f"{d.id}.{EXT[d.format]}")
        stem = name.rsplit(".", 1)[0] if "." in name else name
        name = f"{stem}.{EXT[d.format]}"
        k = 2
        while name.lower() in used_names:
            name = f"{stem}_{k}.{EXT[d.format]}"
            k += 1
        used_names.add(name.lower())
        out_path = out_dir / name

        res = DeliverableResult(d.id, name, d.format, None, d.base_file_id, d.purpose, False, None)
        results.append(res)
        base: Path | None = None
        if d.base_file_id:
            meta = inputs.get(d.base_file_id)
            if meta is None or meta["kind"] not in BASE_KINDS[d.format]:
                res.warnings.append("La plantilla indicada no es válida para este formato; se crea un archivo nuevo.")
            else:
                base = Path(meta["path"])

        ctx = ExecContext(fmt=d.format, out_path=out_path, inputs=inputs, work_dir=work_dir, student_name=student_name, date=date,
                          base_structure=structures.get(d.base_file_id) if base else None, produced=produced)
        opener, saver, _ = FORMATS[d.format]
        try:
            opener(ctx, base)
        except Exception as e:  # noqa: BLE001
            res.error = f"No se pudo abrir la plantilla: {e}"
            continue

        for i, op in enumerate(d.ops):
            step = {"n": i + 1, "op": op.op, "covers": op.covers, "explanation": op.explanation, "status": "ok", "message": ""}
            res.steps.append(step)
            if budget <= 0:
                step.update(status="error", message="Límite de operaciones alcanzado.")
                continue
            budget -= 1
            spec = REGISTRY.get(op.op)
            if spec is None or spec.fmt != d.format:
                step.update(status="error", message="Operación no permitida para este formato.")
                continue
            try:
                args = parse_args(spec, op.args_json, ctx)
                ctx.current_covers = list(op.covers)
                step["message"] = spec.handler(ctx, args)
            except OpError as e:
                step.update(status="error", message=str(e))
            except Exception as e:  # noqa: BLE001 - un fallo inesperado no debe tumbar todo el trabajo
                step.update(status="error", message=f"Error interno en {op.op}: {type(e).__name__}: {e}")
            finally:
                ctx.current_covers = []

        try:
            saver(ctx)
            res.path = out_path
            res.ok = True
            produced[d.id] = out_path
        except Exception as e:  # noqa: BLE001
            res.error = f"No se pudo guardar el archivo: {e}"
        res.warnings.extend(ctx.warnings)
        res.checks = ctx.checks
        res.deleted = {"sheets": ctx.state.get("deleted_sheets", [])}
        if ctx.fmt == "pdf" and isinstance(ctx.obj, dict) and ctx.obj.get("mode") == "edit":
            ctx.obj["doc"].close()
    return results

