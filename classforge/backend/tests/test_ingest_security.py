import io
import zipfile

import pytest

from app.ingest import ingest_file
from app.security import FileRejected, check_formula, scan_for_injection, validate_upload
from app.storage import safe_filename
from tests import fixtures as fx


def meta(fid, name, kind):
    return {"id": fid, "name": name, "kind": kind}


def test_ingest_docx_template(tmp):
    p = fx.make_word_template(tmp / "Practica.docx")
    rec = ingest_file(p, meta("f1", "Practica.docx", "docx"), tmp / "w")
    assert rec["ok"], rec["error"]
    assert "[P1] (Normal) Nombre y apellidos: ____________________" in rec["text"]
    assert "[T0 R1] C0=CPU | C1=∅" in rec["text"]
    assert "Encabezado" in rec["text"] and "Digitalización" in rec["text"]
    s = rec["structure"]
    assert s["tables"] == 1 and s["table_shapes"] == [[4, 2]]
    assert any(ph["where"] == "P1" for ph in s["placeholders"])


def test_ingest_xlsx(tmp):
    p = fx.make_excel_template(tmp / "Ventas.xlsx")
    rec = ingest_file(p, meta("f2", "Ventas.xlsx", "xlsx"), tmp / "w")
    assert rec["ok"]
    names = [s["name"] for s in rec["structure"]["sheets"]]
    assert names == ["Ventas", "Resumen", "Instrucciones"]
    assert 'A3="Ratón"' in rec["text"] and "B3=25" in rec["text"]
    assert "A1:E1" in rec["structure"]["sheets"][0]["merged"]


def test_ingest_pdf_csv_image_pptx(tmp):
    pdf = ingest_file(fx.make_pdf_statement(tmp / "e.pdf"), meta("a", "e.pdf", "pdf"), tmp / "w")
    assert pdf["ok"] and "presentación de 3 diapositivas" in pdf["text"]
    csvr = ingest_file(fx.make_csv(tmp / "d.csv"), meta("b", "d.csv", "csv"), tmp / "w")
    assert csvr["structure"]["delimiter"] == ";" and csvr["structure"]["rows"] == 5
    img = ingest_file(fx.make_png(tmp / "i.png"), meta("c", "i.png", "image"), tmp / "w")
    assert img["ok"] and len(img["images"]) == 1 and (tmp / "w" / img["images"][0]["path"]).exists()

    from pptx import Presentation
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Hola"
    s.placeholders[1].text = "Punto 1"
    prs.save(tmp / "p.pptx")
    pp = ingest_file(tmp / "p.pptx", meta("d", "p.pptx", "pptx"), tmp / "w")
    assert pp["ok"] and "título: 'Hola'" in pp["text"] and "Punto 1" in pp["text"]


def test_ingest_detects_injection(tmp):
    p = fx.make_malicious_docx(tmp / "m.docx")
    rec = ingest_file(p, meta("m", "m.docx", "docx"), tmp / "w")
    reasons = {f["reason"] for f in rec["flags"]}
    assert "Pide ignorar instrucciones anteriores" in reasons
    assert "Solicita claves o secretos" in reasons
    assert "Contiene código potencialmente peligroso" in reasons


def test_ingest_broken_file_reports_error(tmp):
    p = tmp / "roto.docx"
    p.write_bytes(b"PK\x03\x04 esto no es un docx")
    rec = ingest_file(p, meta("x", "roto.docx", "docx"), tmp / "w")
    assert not rec["ok"] and "No se pudo leer" in rec["error"]


def test_validate_upload(tmp):
    good = fx.make_word_template(tmp / "a.docx").read_bytes()
    assert validate_upload("a.docx", good) == "docx"
    assert validate_upload("x.png", fx.make_png(tmp / "x.png").read_bytes()) == "image"
    with pytest.raises(FileRejected):
        validate_upload("a.exe", b"MZ...")
    with pytest.raises(FileRejected):
        validate_upload("a.docx", b"%PDF-1.4 falso")
    with pytest.raises(FileRejected):
        validate_upload("a.pdf", b"no soy pdf")
    with pytest.raises(FileRejected):
        validate_upload("a.png", b"\xff\xd8\xff jpg disfrazado")
    # xlsx con macros
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", "<x/>")
        z.writestr("xl/vbaProject.bin", "macro")
    with pytest.raises(FileRejected, match="macros"):
        validate_upload("m.xlsx", buf.getvalue())
    # docx sin estructura
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hola.txt", "x")
    with pytest.raises(FileRejected):
        validate_upload("z.docx", buf.getvalue())
    with pytest.raises(FileRejected):
        validate_upload("v.docx", b"")


def test_formula_and_filename_safety():
    assert check_formula("=SUM(A1:A3)") is None
    assert check_formula('=WEBSERVICE("http://evil")') is not None
    assert check_formula("=cmd|' /C calc'!A0") is not None
    assert check_formula("='[otro.xlsx]Hoja1'!A1") is not None
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("Práctica 2: Excel?.xlsx") == "Práctica_2_Excel_.xlsx"
    assert safe_filename("") == "archivo"


def test_scan_benign_text_has_no_flags():
    assert scan_for_injection("Ejercicio 1: calcula la media de las notas y haz un gráfico.", "x") == []
