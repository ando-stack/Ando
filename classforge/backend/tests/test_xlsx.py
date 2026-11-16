import openpyxl
import pytest

from app.convert import soffice
from app.validate import formula_errors
from tests import fixtures as fx
from tests.helpers import deliverable, op, run

needs_lo = pytest.mark.skipif(not soffice(), reason="LibreOffice no instalado")


def excel_plan():
    return [
        op("xlsx.fill_formula", ["R1"], sheet="Ventas", range="D3:D7", formula="=B3*C3"),
        op("xlsx.fill_formula", ["R1"], sheet="Ventas", range="E3:E7", formula="=D3*0.21"),
        op("xlsx.set_cells", ["R2"], sheet="Resumen", cells=[
            {"ref": "B1", "value": "=SUM(Ventas!D3:D7)", "number_format": "#,##0.00 €"},
            {"ref": "B2", "value": "=AVERAGE(Ventas!B3:B7)", "number_format": "0.00"},
            {"ref": "B3", "value": "=MAX(Ventas!C3:C7)"},
            {"ref": "A5", "value": "Alumno: {{ALUMNO}}"},
        ]),
        op("xlsx.add_chart", ["R3"], sheet="Ventas", chart_type="column", data_range="D2:D7", categories_range="A3:A7", title="Total por producto", anchor="G2", y_title="€"),
        op("xlsx.format_range", ["R4"], sheet="Ventas", range="C3:E7", number_format="#,##0.00 €"),
        op("xlsx.format_range", [], sheet="Ventas", range="A2:E2", bold=True, fill_color="#DDEBF7", border="thin"),
        op("xlsx.conditional_format", [], sheet="Ventas", range="D3:D7", kind="cell_is", operator="greaterThan", values=["1000"], fill_color="C6EFCE"),
        op("xlsx.data_validation", [], sheet="Ventas", range="B3:B7", kind="whole", operator="greaterThanOrEqual", min="0"),
        op("xlsx.define_name", [], name="Totales", sheet="Ventas", range="D3:D7"),
        op("xlsx.freeze_panes", [], sheet="Ventas", cell="A3"),
        op("xlsx.set_dimensions", [], sheet="Ventas", autofit_columns="A:E"),
    ]


@needs_lo
def test_complete_excel_template_with_real_formulas(tmp):
    tpl = fx.make_excel_template(tmp / "Ventas.xlsx")
    reqs = [{"id": f"R{i}", "text": "x", "mandatory": True} for i in range(1, 5)]
    errors, results, report = run(tmp, {"x": (tpl, "xlsx")}, [deliverable("D1", "xlsx", "Ana_Ventas.xlsx", excel_plan(), base="x")], reqs)
    assert errors == []
    r = results[0]
    assert all(s["status"] == "ok" for s in r.steps), [s for s in r.steps if s["status"] != "ok"]
    assert report["problems"] == [], report["problems"]
    dr = report["deliverables"][0]
    assert dr["formula_errors"] == []
    assert all(t["ok"] for t in dr["template"])  # hojas y celdas combinadas conservadas

    wb = openpyxl.load_workbook(r.path)
    assert wb.sheetnames == ["Ventas", "Resumen", "Instrucciones"]
    assert wb["Ventas"]["D7"].value == "=B7*C7" and wb["Ventas"]["E5"].value == "=D5*0.21"
    assert "A1:E1" in {str(m) for m in wb["Ventas"].merged_cells.ranges}
    assert len(wb["Ventas"]._charts) == 1
    assert wb["Resumen"]["A5"].value == "Alumno: Ana López"
    assert "Totales" in wb.defined_names

    # Valores calculados de verdad (recalculo con LibreOffice)
    vals = openpyxl.load_workbook(dr["recalculated"], data_only=True)
    expected_total = 25 * 12.5 + 18 * 24.9 + 7 * 159 + 4 * 649 + 40 * 8.75
    assert vals["Resumen"]["B1"].value == pytest.approx(expected_total)
    assert vals["Resumen"]["B2"].value == pytest.approx((25 + 18 + 7 + 4 + 40) / 5)
    assert vals["Resumen"]["B3"].value == 649
    assert vals["Ventas"]["E3"].value == pytest.approx(25 * 12.5 * 0.21)


@needs_lo
def test_formula_errors_are_detected(tmp):
    ops = [op("xlsx.add_sheet", name="Datos"),
           op("xlsx.set_cells", ["R1"], sheet="Datos", cells=[{"ref": "A1", "value": 5}, {"ref": "A2", "value": "=A1/0"}, {"ref": "A3", "value": "=SUMA(A1)"}])]
    errors, results, report = run(tmp, {}, [deliverable("D1", "xlsx", "e.xlsx", ops)], [{"id": "R1", "text": "x", "mandatory": True}])
    errs = report["deliverables"][0]["formula_errors"]
    assert {e["cell"] for e in errs} == {"A2", "A3"}
    assert any("#DIV/0!" in p for p in report["problems"])
    wb = openpyxl.load_workbook(results[0].path)
    assert wb.sheetnames == ["Datos"]  # la hoja vacía por defecto se reutilizó


def test_dangerous_formulas_rejected(tmp):
    ops = [op("xlsx.add_sheet", name="H"),
           op("xlsx.set_cells", sheet="H", cells=[{"ref": "A1", "value": '=WEBSERVICE("http://x.com")'}]),
           op("xlsx.fill_formula", sheet="H", range="B1:B3", formula="=cmd|' /C calc'!A0")]
    errors, results, report = run(tmp, {}, [deliverable("D1", "xlsx", "e.xlsx", ops)])
    assert [s["status"] for s in results[0].steps] == ["ok", "error", "error"]
    assert "rechazada" in results[0].steps[1]["message"]


def test_write_table_import_csv_sort_and_other_charts(tmp):
    csvp = fx.make_csv(tmp / "notas.csv")
    ops = [
        op("xlsx.add_sheet", name="Notas"),
        op("xlsx.import_csv", file_id="c", sheet="Notas"),
        op("xlsx.sort_range", sheet="Notas", range="A1:C5", by_column="B", descending=True),
        op("xlsx.add_sheet", name="Tabla"),
        op("xlsx.write_table", sheet="Tabla", top_left="B2", header=["Mes", "Gasto"], rows=[["Enero", 10], ["Febrero", 20.5], ["Total", "=SUM(C3:C4)"]], excel_table=True, table_name="Gastos"),
        op("xlsx.add_chart", sheet="Tabla", chart_type="pie", data_range="C2:C4", categories_range="B3:B4", title="Reparto"),
        op("xlsx.add_chart", sheet="Notas", chart_type="scatter", data_range="B1:B5", categories_range="B2:B5", title="Disp"),
        op("xlsx.merge_cells", sheet="Tabla", range="E1:F1"),
        op("xlsx.autofilter", sheet="Notas", range="A1:C5"),
        op("xlsx.page_setup", sheet="Notas", orientation="landscape", footer_center="{{ALUMNO}}"),
        op("xlsx.rename_sheet", sheet="Tabla", new_name="Gastos"),
        op("xlsx.copy_sheet", sheet="Notas", new_name="Notas2"),
    ]
    errors, results, report = run(tmp, {"c": (csvp, "csv")}, [deliverable("D1", "xlsx", "n.xlsx", ops)])
    assert errors == []
    assert all(s["status"] == "ok" for s in results[0].steps), [s for s in results[0].steps if s["status"] != "ok"]
    wb = openpyxl.load_workbook(results[0].path)
    ws = wb["Notas"]
    assert [ws.cell(r, 1).value for r in range(2, 6)] == ["Marta", "Ana", "Pablo", "Luis"]
    assert ws["B2"].value == 9.25  # «9,25» convertido a número
    assert "Gastos" in wb["Gastos"].tables
    assert len(wb["Gastos"]._charts) == 1


def test_unknown_sheet_and_bad_refs(tmp):
    ops = [op("xlsx.set_cells", sheet="NoExiste", cells=[{"ref": "A1", "value": 1}]),
           op("xlsx.add_sheet", name="H"),
           op("xlsx.set_cells", sheet="H", cells=[{"ref": "A1;DROP", "value": 1}])]
    errors, results, report = run(tmp, {}, [deliverable("D1", "xlsx", "e.xlsx", ops)])
    assert [s["status"] for s in results[0].steps] == ["error", "ok", "error"]


@needs_lo
def test_formula_errors_helper_direct(tmp):
    wb = openpyxl.Workbook()
    wb.active["A1"] = "=1+1"
    wb.save(tmp / "ok.xlsx")
    errs, rec, note = formula_errors(tmp / "ok.xlsx", tmp / "w")
    assert errs == [] and rec is not None and note is None
