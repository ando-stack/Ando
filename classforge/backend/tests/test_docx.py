import docx

from tests import fixtures as fx
from tests.helpers import deliverable, op, run


def _texts(doc):
    return [p.text for p in doc.paragraphs]


def test_complete_word_template(tmp):
    tpl = fx.make_word_template(tmp / "Practica2.docx")
    ops = [
        op("docx.replace_text", ["R1"], find="Nombre y apellidos: ____________________", replace="Nombre y apellidos: {{ALUMNO}}"),
        op("docx.replace_text", ["R2"], find="____________", replace="{{FECHA}}"),
        op("docx.add_content", ["R3"], after_paragraph=4, blocks=[
            {"type": "paragraph", "text": "La **memoria RAM** es una memoria *volátil* de acceso rápido.\nSe borra al apagar el equipo."},
            {"type": "paragraph", "text": "El almacenamiento (SSD/HDD) conserva los datos."},
        ]),
        op("docx.fill_table_cell", ["R4"], table=0, row=1, col=1, text="Unidad central de proceso: ejecuta las instrucciones."),
        op("docx.fill_table_cell", ["R4"], table=0, row=2, col=1, text="Procesador gráfico."),
        op("docx.fill_table_cell", ["R4"], table=0, row=3, col=1, text="Placa que conecta todos los componentes."),
        op("docx.add_table_rows", ["R4"], table=0, rows=[["RAM", "Memoria principal"]]),
        op("docx.format_text", ["R5"], find="periférico", bold=True),
        op("docx.set_style", ["R6"], style="Normal", font="Arial", size_pt=12),
        op("docx.set_header_footer", ["R7"], footer="{{ALUMNO}}", page_numbers=True),
        op("docx.add_content", [], blocks=[{"type": "heading", "level": 2, "text": "Conclusión"},
                                           {"type": "bullets", "items": ["Uno", "Dos"]},
                                           {"type": "table", "rows": [["A", "B"], ["1", "2"]]},
                                           {"type": "chart", "chart": {"chart_type": "column", "title": "Ventas", "labels": ["x", "y"], "series": [{"name": "s", "values": [1, 2]}]}}]),
    ]
    reqs = [{"id": f"R{i}", "text": f"req {i}", "mandatory": True} for i in range(1, 8)]
    errors, results, report = run(tmp, {"tpl": (tpl, "docx")}, [deliverable("D1", "docx", "Ana_Practica2.docx", ops, base="tpl")], reqs)
    assert errors == []
    r = results[0]
    assert r.ok and all(s["status"] == "ok" for s in r.steps), [s for s in r.steps if s["status"] != "ok"]
    assert report["problems"] == [], report["problems"]
    assert all(c["ok"] for c in report["deliverables"][0]["checks"])
    assert all(t["ok"] for t in report["deliverables"][0]["template"])

    d = docx.Document(str(r.path))
    texts = _texts(d)
    assert "Nombre y apellidos: Ana López" in texts
    assert "Fecha: 16/11/2026" in texts
    # Las respuestas se insertan justo después del enunciado del ejercicio 1 (P4) y en orden
    i = texts.index("Explica con tus palabras qué es la memoria RAM y en qué se diferencia del almacenamiento (mínimo 5 líneas).")
    assert texts[i + 1].startswith("La memoria RAM es una memoria volátil")
    assert texts[i + 2] == "El almacenamiento (SSD/HDD) conserva los datos."
    assert texts[i + 3] == "Ejercicio 2"
    # Formato conservado y aplicado
    runs = d.paragraphs[i + 1].runs
    assert any(r.bold and r.text == "memoria RAM" for r in runs)
    assert any(r.italic and r.text == "volátil" for r in runs)
    t = d.tables[0]
    assert t.cell(1, 1).text.startswith("Unidad central") and len(t.rows) == 5 and t.cell(4, 0).text == "RAM"
    assert d.styles["Normal"].font.name == "Arial" and d.styles["Normal"].font.size.pt == 12
    bold_runs = [r.text for p in d.paragraphs for r in p.runs if r.bold]
    assert "periférico" in bold_runs
    assert d.sections[0].header.paragraphs[0].text == "IES Ejemplo · Digitalización 1º"  # encabezado de la plantilla intacto
    assert "Ana López" in d.sections[0].footer.paragraphs[0].text
    assert len(d.inline_shapes) == 1  # gráfico insertado
    assert len(d.tables) == 2


def test_replace_across_runs_keeps_formatting(tmp):
    path = tmp / "runs.docx"
    d = docx.Document()
    p = d.add_paragraph()
    a = p.add_run("Hola [NOM")
    a.bold = True
    p.add_run("BRE] adiós")
    d.save(path)
    errors, results, report = run(tmp, {"f": (path, "docx")}, [deliverable("D1", "docx", "x.docx", [op("docx.replace_text", find="[NOMBRE]", replace="Luis")], base="f")])
    out = docx.Document(str(results[0].path))
    assert out.paragraphs[0].text == "Hola Luis adiós"
    assert [r.text for r in out.paragraphs[0].runs if r.bold] == ["Hola ", "Luis"]


def test_errors_are_reported_not_hidden(tmp):
    tpl = fx.make_word_template(tmp / "t.docx")
    ops = [op("docx.replace_text", ["R1"], find="TEXTO QUE NO EXISTE", replace="x"),
           op("docx.fill_table_cell", ["R2"], table=7, row=0, col=0, text="x")]
    reqs = [{"id": "R1", "text": "a", "mandatory": True}, {"id": "R2", "text": "b", "mandatory": True}]
    errors, results, report = run(tmp, {"t": (tpl, "docx")}, [deliverable("D1", "docx", "x.docx", ops, base="t")], reqs)
    assert [s["status"] for s in results[0].steps] == ["error", "error"]
    assert report["coverage"] == {"R1": "sin_cubrir", "R2": "sin_cubrir"}
    assert len(report["problems"]) >= 4


def test_new_document_from_scratch_with_image_and_toc(tmp):
    img = fx.make_png(tmp / "red.png")
    ops = [op("docx.add_content", blocks=[{"type": "heading", "level": 1, "text": "Trabajo de redes"}, {"type": "toc"},
                                          {"type": "image", "file_id": "img", "width_cm": 10, "caption": "Figura 1"},
                                          {"type": "numbered", "items": ["Router", "Switch"]}, {"type": "page_break"}]),
           op("docx.set_page", orientation="landscape", margins_cm=2),
           op("docx.set_properties", title="Redes", author="{{ALUMNO}}")]
    errors, results, report = run(tmp, {"img": (img, "image")}, [deliverable("D1", "docx", "Redes.docx", ops)])
    assert errors == [] and report["problems"] == []
    d = docx.Document(str(results[0].path))
    assert d.core_properties.author == "Ana López"
    assert d.sections[0].page_width > d.sections[0].page_height
    assert len(d.inline_shapes) == 1
    assert "List Number" in {p.style.name for p in d.paragraphs}


def test_delete_paragraph_and_insert_in_its_place(tmp):
    tpl = fx.make_word_template(tmp / "t.docx")
    ops = [op("docx.delete_paragraph", index=6), op("docx.add_content", after_paragraph=6, blocks=[{"type": "paragraph", "text": "Respuesta"}])]
    errors, results, report = run(tmp, {"t": (tpl, "docx")}, [deliverable("D1", "docx", "x.docx", ops, base="t")])
    texts = _texts(docx.Document(str(results[0].path)))
    assert "Completa la tabla con la definición de cada componente." not in texts
    assert texts[texts.index("Ejercicio 2") + 1] == "Respuesta"
