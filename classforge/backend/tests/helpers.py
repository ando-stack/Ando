import json
from pathlib import Path

from app.ai.schemas import Plan, PlanOp, PlannedDeliverable
from app.executor import execute_plan, precheck_plan
from app.ingest import ingest_file
from app.validate import validate


def op(_op_name: str, covers=None, **args) -> PlanOp:
    return PlanOp(op=_op_name, args_json=json.dumps(args, ensure_ascii=False), covers=covers or [], explanation=f"Paso {_op_name}")


def deliverable(id_, fmt, filename, ops, base=None) -> PlannedDeliverable:
    return PlannedDeliverable(id=id_, format=fmt, filename=filename, base_file_id=base, purpose="prueba", ops=ops)


def run(tmp: Path, files: dict[str, tuple[Path, str]], deliverables, requirements=None, unresolved=None, name="Ana López", date="16/11/2026"):
    inputs = {fid: {"path": str(p), "kind": kind, "name": p.name} for fid, (p, kind) in files.items()}
    structures = {}
    for fid, (p, kind) in files.items():
        rec = ingest_file(p, {"id": fid, "name": p.name, "kind": kind}, tmp / "work")
        structures[fid] = rec["structure"]
    plan = Plan(deliverables=deliverables, notes=[], unresolved=unresolved or [])
    errors = precheck_plan(plan, inputs)
    results = execute_plan(plan, inputs=inputs, structures=structures, out_dir=tmp / "out", work_dir=tmp / "work", student_name=name, date=date)
    interp = {"requirements": requirements or [], "deliverables": []}
    report = validate(results, interpretation=interp, plan_unresolved=[u.model_dump() for u in plan.unresolved], structures=structures, work_dir=tmp / "val")
    return errors, results, report
