import pymupdf
import pytest
from pptx import Presentation

from app.ai.schemas import Plan
from app.convert import soffice
from app.executor import precheck_plan
from tests import fixtures as fx
from tests.helpers import deliverable, op, run

CHART = {"chart_type": "column", "title": "Almacenamiento", "labels": ["Drive", "OneDrive", "Dropbox"], "series": [{"name": "GB gratis", "values": [15, 5, 2]}]}


def test_pptx_new_presentation(tmp):
    img = fx.make_png(tmp / "nube.png")
    ops = [
        op("pptx.add_slide", ["R1"], layout="title", title="La nube", subtitle="{{ALUMNO}} · {{FECHA}}"),
        op("pptx.add_slide", ["R2"], layout="title_content", title="Qué es", bullets=["Servicios por Internet", "  Almacenamiento", "**Ventajas**: acceso"], notes="Explicar ejemplos"),
        op("pptx.add_slide", ["R3"], layout="title_only", title="Comparativa", table={"rows": [["Servicio", "GB"], ["Drive", "15"], ["OneDrive", "5"]], "header": True}),
        op("pptx.add_slide", [], layout="title_only", title="Gráfico", chart=CHART),
        op("pptx.add_slide", [], layout="title_content", title="Imagen", bullets=["Texto"], image_file_id="img"),
        op("pptx.add_slide", [], layout="two_content", title="Pros y contras", bullets=["Pro"], right_bullets=["Contra"]),
    ]
    reqs = [{"id": f"R{i}", "text": "x", "mandatory": True} for i in range(1, 4)]
    errors, results, report = run(tmp, {"img": (img, "image")}, [deliverable("D1", "pptx", "Nube.pptx", ops)], reqs)
    assert errors == [] and report["problems"] == [], report["problems"]
    prs = Presentation(str(results[0].path))
    assert len(prs.slides) == 6
    assert prs.slides[0].placeholders[1].text == "Ana López · 16/11/2026"
    assert prs.slides[1].notes_slide.notes_text_frame.text == "Explicar ejemplos"
    assert any(getattr(s, "has_table", False) and s.has_table for s in prs.slides[2].shapes)
    assert any(getattr(s, "has_chart", False) and s.has_chart for s in prs.slides[3].shapes)
    assert any(s.shape_type == 13 for s in prs.slides[4].shapes)


def test_pptx_edit_template(tmp):
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Tema: [TEMA]"
    s.placeholders[1].text = "Autor: [NOMBRE]"
    prs.slides.add_slide(prs.slide_layouts[1]).shapes.title.text = "Borrar"
    prs.save(tmp / "t.pptx")
    ops = [op("pptx.replace_text", find="[NOMBRE]", replace="{{ALUMNO}}"), op("pptx.replace_text", find="[TEMA]", replace="Ciberseguridad"),
           op("pptx.edit_slide", slide=0, bullets=["Autor: Ana López", "  Grupo A"]), op("pptx.delete_slide", slide=1), op("pptx.set_notes", slide=0, text="Hola")]
    errors, results, report = run(tmp, {"t": (tmp / "t.pptx", "pptx")}, [deliverable("D1", "pptx", "x.pptx", ops, base="t")])
    assert all(st["status"] == "ok" for st in results[0].steps), results[0].steps
    out = Presentation(str(results[0].path))
    assert len(out.slides) == 1 and out.slides[0].shapes.title.text == "Tema: Ciberseguridad"


def test_pdf_new_document(tmp):
    ops = [op("pdf.set_options", title="Resumen", author="{{ALUMNO}}", header="Digitalización", footer="{{ALUMNO}}"),
           op("pdf.add_content", ["R1"], blocks=[{"type": "heading", "level": 1, "text": "Resumen sobre la nube"},
                                                 {"type": "paragraph", "text": "La **nube** permite guardar archivos en servidores remotos."},
                                                 {"type": "bullets", "items": ["Drive", "OneDrive"]},
                                                 {"type": "table", "rows": [["A", "B"], ["1", "2"]]},
                                                 {"type": "chart", "chart": CHART}, {"type": "page_break"},
                                                 {"type": "paragraph", "text": "Página dos"}])]
    errors, results, report = run(tmp, {}, [deliverable("D1", "pdf", "Resumen.pdf", ops)], [{"id": "R1", "text": "x", "mandatory": True}])
    assert report["problems"] == [], report["problems"]
    doc = pymupdf.open(str(results[0].path))
    assert doc.page_count == 2 and "Resumen sobre la nube" in doc[0].get_text() and "Ana López" in doc[0].get_text()
    assert doc.metadata["author"] == "Ana López"


@pytest.mark.skipif(not soffice(), reason="LibreOffice no instalado")
def test_docx_then_convert_to_pdf(tmp):
    tpl = fx.make_word_template(tmp / "t.docx")
    d1 = deliverable("D1", "docx", "Practica.docx", [op("docx.replace_text", find="Nombre y apellidos: ____________________", replace="Nombre y apellidos: {{ALUMNO}}")], base="t")
    d2 = deliverable("D2", "pdf", "Practica.pdf", [op("pdf.convert_from", deliverable_id="D1")])
    errors, results, report = run(tmp, {"t": (tpl, "docx")}, [d1, d2])
    assert report["problems"] == [], report["problems"]
    doc = pymupdf.open(str(results[1].path))
    assert "Ana López" in doc[0].get_text()


def test_pdf_fill_form_and_add_text(tmp):
    doc = pymupdf.open()
    page = doc.new_page()
    w = pymupdf.Widget()
    w.field_name, w.field_type, w.rect = "nombre", pymupdf.PDF_WIDGET_TYPE_TEXT, pymupdf.Rect(100, 100, 300, 120)
    page.add_widget(w)
    doc.save(tmp / "form.pdf")
    ops = [op("pdf.fill_form", fields={"nombre": "{{ALUMNO}}", "inexistente": "x"}), op("pdf.add_text", page=1, x_cm=3, y_cm=8, text="Respuesta 1: 42")]
    errors, results, report = run(tmp, {"f": (tmp / "form.pdf", "pdf")}, [deliverable("D1", "pdf", "ficha.pdf", ops, base="f")])
    assert all(s["status"] == "ok" for s in results[0].steps), results[0].steps
    out = pymupdf.open(str(results[0].path))
    assert next(out[0].widgets()).field_value == "Ana López"
    assert "Respuesta 1: 42" in out[0].get_text()
    assert any("inexistente" in w for w in results[0].warnings)


def test_csv_write_and_transform(tmp):
    src = fx.make_csv(tmp / "notas.csv")
    d1 = deliverable("D1", "csv", "aprobados.csv", [op("csv.transform", file_id="c", columns=["Alumno", "Nota"], filters=[{"column": "Nota", "op": ">=", "value": "5"}], sort_by="Nota", descending=True)])
    d2 = deliverable("D2", "csv", "propio.csv", [op("csv.write", header=["a", "b"], rows=[["1", "2"]], delimiter=",")])
    errors, results, report = run(tmp, {"c": (src, "csv")}, [d1, d2])
    assert report["problems"] == [], report["problems"]
    text = results[0].path.read_text(encoding="utf-8-sig")
    assert text.splitlines() == ["Alumno;Nota", "Marta;9,25", "Ana;8,5", "Pablo;6,5"]
    assert results[1].path.read_text(encoding="utf-8-sig").splitlines() == ["a,b", "1,2"]


def test_precheck_catches_invalid_plans(tmp):
    plan = Plan(deliverables=[
        deliverable("D1", "docx", "a.docx", [op("docx.no_existe"), op("xlsx.set_cells", sheet="x", cells=[]), op("docx.replace_text", find="")], base="zz"),
        deliverable("D1", "xlsx", "b.xlsx", [op("xlsx.add_chart", sheet="H")]),
    ], notes=[], unresolved=[])
    plan.deliverables[0].ops.append(plan.deliverables[0].ops[0].model_copy(update={"op": "docx.add_content", "args_json": "{no json"}))
    errs = precheck_plan(plan, {})
    joined = "\n".join(errs)
    assert "operación inexistente" in joined
    assert "es de formato xlsx" in joined
    assert "base_file_id" in joined
    assert "Id de entregable duplicado" in joined
    assert "data_range" in joined
    assert "no es JSON válido" in joined


def test_file_ids_outside_job_are_rejected(tmp):
    ops = [op("docx.add_content", blocks=[{"type": "image", "file_id": "../../etc/passwd"}])]
    errors, results, report = run(tmp, {}, [deliverable("D1", "docx", "../../evil.docx", ops)])
    assert results[0].steps[0]["status"] == "error"
    assert results[0].path.parent == tmp / "out" and results[0].filename == "evil.docx"
