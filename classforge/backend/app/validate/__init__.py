"""Etapa 5: VALIDACIÓN. Reabre cada archivo generado y comprueba de verdad que:
  - se abre correctamente,
  - se aplicaron las operaciones (comprobaciones registradas por cada herramienta),
  - se conservan hojas/tablas/elementos de la plantilla,
  - las fórmulas no producen errores al recalcular (con LibreOffice, si está),
  - todos los requisitos obligatorios están cubiertos y todos los entregables existen.
"""
from __future__ import annotations

from pathlib import Path

from ..convert import ConversionUnavailable, recalculated_copy, soffice
from ..executor import DeliverableResult
from ..tools import FORMATS

ERROR_VALUES = {"#DIV/0!", "#NAME?", "#REF!", "#VALUE!", "#N/A", "#NUM!", "#NULL!", "#SPILL!", "#CALC!", "Err:502", "Err:504", "Err:508", "Err:509", "Err:511"}


def _template_checks(res: DeliverableResult, reopened, base_structure: dict | None) -> list[dict]:
    out = []
    if not base_structure:
        return out
    if res.format == "xlsx":
        deleted = set(res.deleted.get("sheets", []))
        for sh in base_structure.get("sheets", []):
            name = sh["name"]
            if name in deleted:
                continue
            present = name in reopened.sheetnames
            out.append({"description": f"Se conserva la hoja «{name}» de la plantilla", "ok": present})
            if not present:
                continue
            ws = reopened[name]
            if sh.get("charts"):
                out.append({"description": f"Se conservan los {sh['charts']} gráfico(s) de «{name}»", "ok": len(ws._charts) >= sh["charts"]})
            if sh.get("merged"):
                now = {str(r) for r in ws.merged_cells.ranges}
                kept = all(m in now for m in sh["merged"])
                out.append({"description": f"Se conservan las celdas combinadas de «{name}»", "ok": kept})
            if sh.get("data_validations"):
                out.append({"description": f"Se conservan las validaciones de datos de «{name}»", "ok": len(ws.data_validations.dataValidation) >= sh["data_validations"]})
    elif res.format == "docx":
        out.append({"description": f"Se conservan las {base_structure.get('tables', 0)} tabla(s) de la plantilla", "ok": len(reopened.tables) >= base_structure.get("tables", 0)})
        styles_now = {s.name for s in reopened.styles}
        missing = [s for s in base_structure.get("styles", []) if s not in styles_now]
        out.append({"description": "Se conservan los estilos de la plantilla", "ok": not missing, "detail": ", ".join(missing[:5])})
        if base_structure.get("headers"):
            now = " ".join(p.text for s in reopened.sections for p in s.header.paragraphs)
            out.append({"description": "Se conserva un encabezado de página", "ok": bool(now.strip())})
    elif res.format == "pptx":
        n = len(base_structure.get("slides", []))
        out.append({"description": f"La presentación conserva sus {n} diapositiva(s) originales", "ok": len(reopened.slides) >= n or any(s["status"] == "ok" and s["op"] == "pptx.delete_slide" for s in res.steps)})
    return out


def formula_errors(path: Path, work_dir: Path) -> tuple[list[dict], Path | None, str | None]:
    """Recalcula con LibreOffice y devuelve las celdas con error."""
    import openpyxl

    try:
        rec = recalculated_copy(path, work_dir)
    except ConversionUnavailable as e:
        return [], None, str(e)
    except Exception as e:  # noqa: BLE001
        return [], None, f"No se pudo recalcular: {e}"
    formulas = openpyxl.load_workbook(str(path))
    values = openpyxl.load_workbook(str(rec), data_only=True)
    errs = []
    for ws in formulas.worksheets:
        if ws.title not in values.sheetnames:
            continue
        vws = values[ws.title]
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("="):
                    v = vws[c.coordinate].value
                    if isinstance(v, str) and v.strip() in ERROR_VALUES:
                        errs.append({"sheet": ws.title, "cell": c.coordinate, "formula": c.value, "value": v})
    return errs, rec, None


def validate(results: list[DeliverableResult], *, interpretation: dict, plan_unresolved: list[dict],
             structures: dict[str, dict], work_dir: Path) -> dict:
    report = {"deliverables": [], "problems": [], "coverage": {}, "formula_engine": bool(soffice())}
    covered: set[str] = set()

    for res in results:
        d = {"id": res.id, "filename": res.filename, "format": res.format, "opens": False, "checks": [], "template": [],
             "formula_errors": [], "failed_steps": [], "warnings": res.warnings, "recalculated": None, "notes": []}
        report["deliverables"].append(d)
        for s in res.steps:
            if s["status"] == "ok":
                covered.update(s["covers"])
            else:
                d["failed_steps"].append({"n": s["n"], "op": s["op"], "message": s["message"]})
                report["problems"].append(f"{res.filename}: falló el paso {s['n']} ({s['op']}): {s['message']}")
        if not res.ok or res.path is None:
            report["problems"].append(f"{res.filename}: {res.error or 'no se generó'}")
            continue
        _, _, reopen = FORMATS[res.format]
        try:
            reopened = reopen(res.path)
            d["opens"] = True
        except Exception as e:  # noqa: BLE001
            report["problems"].append(f"{res.filename}: el archivo generado no se abre ({e}).")
            continue
        for chk in res.checks:
            try:
                ok = bool(chk.fn(reopened))
            except Exception:  # noqa: BLE001
                ok = False
            d["checks"].append({"description": chk.description, "ok": ok, "covers": chk.covers})
            if not ok:
                report["problems"].append(f"{res.filename}: no se verificó «{chk.description}».")
        base_struct = structures.get(res.base_file_id) if res.base_file_id else None
        for t in _template_checks(res, reopened, base_struct):
            d["template"].append(t)
            if not t["ok"]:
                report["problems"].append(f"{res.filename}: {t['description']} — NO se cumple.")
        if res.format == "xlsx":
            errs, rec, note = formula_errors(res.path, work_dir / res.id)
            d["formula_errors"] = errs
            d["recalculated"] = str(rec) if rec else None
            if note:
                d["notes"].append(note)
            for e in errs:
                report["problems"].append(f"{res.filename}: la fórmula {e['formula']} en {e['sheet']}!{e['cell']} da {e['value']}.")
        if res.format == "pdf" and reopened.page_count == 0:
            report["problems"].append(f"{res.filename}: el PDF no tiene páginas.")
        if res.format == "pdf":
            reopened.close()

    # Cobertura de requisitos
    reqs = interpretation.get("requirements", [])
    unresolved_ids = {u["requirement_id"] for u in plan_unresolved}
    for r in reqs:
        rid = r["id"]
        status = "cubierto" if rid in covered else ("no_resoluble" if rid in unresolved_ids else "sin_cubrir")
        report["coverage"][rid] = status
        if r.get("mandatory") and status == "sin_cubrir":
            report["problems"].append(f"El requisito obligatorio {rid} («{r['text'][:80]}») no está cubierto por ninguna operación correcta.")
        if r.get("mandatory") and status == "no_resoluble":
            reason = next((u["reason"] for u in plan_unresolved if u["requirement_id"] == rid), "")
            report["problems"].append(f"El requisito {rid} no se pudo realizar automáticamente: {reason}")

    # Entregables pedidos vs generados
    produced_formats = [r.format for r in results if r.ok]
    for spec in interpretation.get("deliverables", []):
        if spec["format"] in produced_formats:
            produced_formats.remove(spec["format"])
        else:
            report["problems"].append(f"Falta el entregable {spec['id']} ({spec['format'].upper()}: {spec['filename']}).")
    return report
