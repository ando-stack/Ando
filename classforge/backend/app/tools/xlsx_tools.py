"""Herramientas XLSX con openpyxl: celdas, fórmulas, hojas, formatos, gráficos,
formatos condicionales, validaciones, nombres definidos e importación CSV."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Literal, Optional, Union

import openpyxl
from openpyxl.chart import AreaChart, BarChart, DoughnutChart, LineChart, PieChart, Reference, ScatterChart, Series
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, FormulaRule
from openpyxl.formula.translate import Translator
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import column_index_from_string, get_column_letter
from openpyxl.utils.cell import range_boundaries
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from pydantic import Field

from ..security import check_formula
from .base import Args, ExecContext, OpError, register

CELL_RE = re.compile(r"^\$?[A-Z]{1,3}\$?[0-9]{1,7}$")
RANGE_RE = re.compile(r"^\$?[A-Z]{1,3}\$?[0-9]{1,7}(:\$?[A-Z]{1,3}\$?[0-9]{1,7})?$")


def open_wb(ctx: ExecContext, base: Path | None) -> None:
    if base:
        ctx.obj = openpyxl.load_workbook(str(base))
    else:
        ctx.obj = openpyxl.Workbook()
        ctx.state["fresh_default_sheet"] = ctx.obj.active.title


def save_wb(ctx: ExecContext) -> None:
    wb = ctx.obj
    # Si se creó un libro nuevo y la hoja por defecto quedó vacía y sin usar, se elimina.
    fresh = ctx.state.get("fresh_default_sheet")
    if fresh and fresh in wb.sheetnames and len(wb.sheetnames) > 1:
        ws = wb[fresh]
        if ws.max_row == 1 and ws.max_column == 1 and ws["A1"].value is None and not ctx.state.get("used_default"):
            wb.remove(ws)
    # Excel recalcula todas las fórmulas al abrir el archivo.
    wb.calculation.fullCalcOnLoad = True
    wb.save(str(ctx.out_path))


def reopen(path: Path):
    return openpyxl.load_workbook(str(path))


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def sheet(ctx: ExecContext, name: str):
    wb = ctx.obj
    if name in wb.sheetnames:
        if name == ctx.state.get("fresh_default_sheet"):
            ctx.state["used_default"] = True
        return wb[name]
    lower = {s.lower(): s for s in wb.sheetnames}
    if name.lower() in lower:
        return wb[lower[name.lower()]]
    raise OpError(f"La hoja «{name}» no existe. Hojas: {', '.join(wb.sheetnames)}.")


def check_ref(ref: str, kind: str = "range") -> str:
    ref = ref.strip().upper()
    rx = CELL_RE if kind == "cell" else RANGE_RE
    if not rx.match(ref):
        raise OpError(f"Referencia no válida: «{ref}».")
    return ref.replace("$", "")


def coerce(value, ctx: ExecContext):
    """Convierte el valor recibido al tipo adecuado, validando fórmulas."""
    if isinstance(value, str):
        v = value
        if v.startswith("="):
            why = check_formula(v)
            if why:
                raise OpError(f"Fórmula rechazada ({why}): {v}")
            return v
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            try:
                return dt.date.fromisoformat(v)
            except ValueError:
                return v
        return v
    return value


def _rgb(c: Optional[str]) -> Optional[str]:
    if not c:
        return None
    c = c.strip().lstrip("#").upper()
    if not re.fullmatch(r"[0-9A-F]{6}([0-9A-F]{2})?", c):
        raise OpError(f"Color no válido: {c} (usa RRGGBB)")
    return c[-6:]


def _cells(ws, rng: str):
    min_col, min_row, max_col, max_row = range_boundaries(rng)
    for r in range(min_row, max_row + 1):
        for c in range(min_col, max_col + 1):
            yield ws.cell(row=r, column=c)


Value = Union[str, float, int, bool, None]


# --------------------------------------------------------------------------- #
# Hojas
# --------------------------------------------------------------------------- #
class AddSheet(Args):
    name: str = Field(..., min_length=1, max_length=31)
    position: Optional[int] = None


@register("xlsx.add_sheet", "xlsx", AddSheet, "Crea una hoja nueva (nombre máx. 31 caracteres, sin : \\ / ? * [ ]).")
def xlsx_add_sheet(ctx: ExecContext, a: AddSheet) -> str:
    if re.search(r"[:\\/?*\[\]]", a.name):
        raise OpError("El nombre de hoja contiene caracteres no permitidos.")
    wb = ctx.obj
    fresh = ctx.state.get("fresh_default_sheet")
    if a.name in wb.sheetnames:
        raise OpError(f"Ya existe la hoja «{a.name}».")
    # En libros nuevos, la primera hoja pedida reutiliza la hoja vacía por defecto.
    if fresh and fresh in wb.sheetnames and not ctx.state.get("used_default") and len(wb.sheetnames) == 1:
        wb[fresh].title = a.name
        ctx.state["fresh_default_sheet"] = None
    else:
        wb.create_sheet(a.name, a.position)
    ctx.check(f"Existe la hoja «{a.name}»", lambda w, n=a.name: n in w.sheetnames)
    return f"Hoja «{a.name}» creada."


class RenameSheet(Args):
    sheet: str
    new_name: str = Field(..., min_length=1, max_length=31)


@register("xlsx.rename_sheet", "xlsx", RenameSheet, "Cambia el nombre de una hoja.")
def xlsx_rename_sheet(ctx: ExecContext, a: RenameSheet) -> str:
    ws = sheet(ctx, a.sheet)
    old = ws.title
    ws.title = a.new_name
    if ctx.state.get("fresh_default_sheet") == old:
        ctx.state["fresh_default_sheet"] = None
    ctx.check(f"Existe la hoja «{a.new_name}»", lambda w, n=a.new_name: n in w.sheetnames)
    return f"Hoja «{old}» renombrada a «{a.new_name}»."


class CopySheet(Args):
    sheet: str
    new_name: str = Field(..., min_length=1, max_length=31)


@register("xlsx.copy_sheet", "xlsx", CopySheet, "Duplica una hoja (valores, fórmulas y formatos).")
def xlsx_copy_sheet(ctx: ExecContext, a: CopySheet) -> str:
    ws = sheet(ctx, a.sheet)
    new = ctx.obj.copy_worksheet(ws)
    new.title = a.new_name
    return f"Hoja «{a.sheet}» duplicada como «{a.new_name}»."


class DeleteSheet(Args):
    sheet: str


@register("xlsx.delete_sheet", "xlsx", DeleteSheet, "Elimina una hoja. Usar solo si el enunciado lo pide expresamente.")
def xlsx_delete_sheet(ctx: ExecContext, a: DeleteSheet) -> str:
    ws = sheet(ctx, a.sheet)
    if len(ctx.obj.sheetnames) == 1:
        raise OpError("No se puede eliminar la única hoja del libro.")
    ctx.obj.remove(ws)
    ctx.state.setdefault("deleted_sheets", []).append(a.sheet)
    return f"Hoja «{a.sheet}» eliminada."


# --------------------------------------------------------------------------- #
# Celdas y fórmulas
# --------------------------------------------------------------------------- #
class CellValue(Args):
    ref: str = Field(..., description="Celda, p.ej. B3")
    value: Value = Field(..., description="Número, texto, booleano, fecha AAAA-MM-DD o fórmula que empiece por '='")
    number_format: Optional[str] = Field(None, description="p.ej. '0.00', '#,##0.00 €', '0%', 'dd/mm/yyyy'")


class SetCells(Args):
    sheet: str
    cells: list[CellValue] = Field(..., min_length=1)


@register("xlsx.set_cells", "xlsx", SetCells, "Escribe valores o fórmulas en celdas concretas. Las fórmulas en inglés con coma como separador (=SUM(B2:B5), =IF(A1>5,\"Sí\",\"No\")).")
def xlsx_set_cells(ctx: ExecContext, a: SetCells) -> str:
    ws = sheet(ctx, a.sheet)
    n_f = 0
    for cv in a.cells:
        ref = check_ref(cv.ref, "cell")
        val = coerce(cv.value, ctx)
        ws[ref] = val
        if cv.number_format:
            ws[ref].number_format = cv.number_format
        elif isinstance(val, dt.date):
            ws[ref].number_format = "dd/mm/yyyy"
        if isinstance(val, str) and val.startswith("="):
            n_f += 1
            ctx.check(f"{ws.title}!{ref} contiene la fórmula {val}", lambda w, s=ws.title, r=ref, f=val: s in w.sheetnames and w[s][r].value == f)
        elif val is not None:
            ctx.check(f"{ws.title}!{ref} = {str(val)[:30]}", lambda w, s=ws.title, r=ref, v=val: s in w.sheetnames and _same(w[s][r].value, v))
    return f"{len(a.cells)} celda(s) escritas en «{ws.title}» ({n_f} fórmula(s))."


def _same(a, b) -> bool:
    if isinstance(a, dt.datetime) and isinstance(b, dt.date):
        return a.date() == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) < 1e-9
    return a == b


class WriteTable(Args):
    sheet: str
    top_left: str = "A1"
    header: list[str] = Field(default_factory=list)
    rows: list[list[Value]] = Field(default_factory=list)
    style_header: bool = True
    excel_table: bool = Field(False, description="Convertir el rango en una Tabla de Excel con filtros")
    table_name: Optional[str] = None
    table_style: str = "TableStyleMedium2"
    borders: bool = True
    autofit: bool = True


@register("xlsx.write_table", "xlsx", WriteTable, "Escribe un bloque de datos (cabecera + filas) desde una celda; opcionalmente como Tabla de Excel, con bordes y ancho automático. Las filas pueden contener fórmulas.")
def xlsx_write_table(ctx: ExecContext, a: WriteTable) -> str:
    ws = sheet(ctx, a.sheet)
    tl = check_ref(a.top_left, "cell")
    col0 = column_index_from_string(re.match(r"[A-Z]+", tl).group(0))
    row0 = int(re.search(r"\d+", tl).group(0))
    all_rows = ([a.header] if a.header else []) + a.rows
    if not all_rows:
        raise OpError("La tabla no tiene datos.")
    ncols = max(len(r) for r in all_rows)
    thin = Side(style="thin", color="999999")
    for r_i, row in enumerate(all_rows):
        for c_i in range(ncols):
            v = coerce(row[c_i], ctx) if c_i < len(row) else None
            cell = ws.cell(row=row0 + r_i, column=col0 + c_i, value=v)
            if isinstance(v, dt.date):
                cell.number_format = "dd/mm/yyyy"
            if a.borders:
                cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
            if a.header and r_i == 0 and a.style_header and not a.excel_table:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="305496")
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    end = f"{get_column_letter(col0 + ncols - 1)}{row0 + len(all_rows) - 1}"
    rng = f"{tl}:{end}"
    if a.excel_table:
        if not a.header:
            raise OpError("Una Tabla de Excel necesita cabecera.")
        name = re.sub(r"[^A-Za-z0-9_]", "_", a.table_name or f"Tabla{len(ws.tables) + 1}")
        if not re.match(r"[A-Za-z_]", name):
            name = "T_" + name
        t = Table(displayName=name, ref=rng)
        t.tableStyleInfo = TableStyleInfo(name=a.table_style, showRowStripes=True)
        ws.add_table(t)
        ctx.check(f"Existe la tabla de Excel «{name}»", lambda w, s=ws.title, n=name: n in w[s].tables)
    if a.autofit:
        _autofit(ws, col0, col0 + ncols - 1)
    first = all_rows[0][0] if all_rows[0] else None
    ctx.check(f"{ws.title}!{tl} contiene «{first}»", lambda w, s=ws.title, r=tl, v=coerce(first, ctx): s in w.sheetnames and _same(w[s][r].value, v))
    ctx.state.setdefault("ranges", {})[ws.title] = rng
    return f"Tabla escrita en «{ws.title}»!{rng} ({len(all_rows)} filas × {ncols} columnas)."


def _autofit(ws, c1: int, c2: int) -> None:
    for c in range(c1, c2 + 1):
        letter = get_column_letter(c)
        width = 8
        for cell in ws[letter]:
            if cell.value is not None:
                s = str(cell.value)
                width = max(width, min(60, (12 if s.startswith("=") else len(s)) + 2))
        ws.column_dimensions[letter].width = width


class FillFormula(Args):
    sheet: str
    range: str = Field(..., description="Rango destino, p.ej. D2:D20")
    formula: str = Field(..., description="Fórmula para la PRIMERA celda del rango; se copia ajustando referencias relativas (como arrastrar el controlador de relleno)")
    number_format: Optional[str] = None


@register("xlsx.fill_formula", "xlsx", FillFormula, "Escribe una fórmula en la primera celda de un rango y la rellena hacia abajo/derecha ajustando las referencias relativas ($ para absolutas).")
def xlsx_fill_formula(ctx: ExecContext, a: FillFormula) -> str:
    ws = sheet(ctx, a.sheet)
    rng = check_ref(a.range)
    if not a.formula.startswith("="):
        raise OpError("La fórmula debe empezar por '='.")
    why = check_formula(a.formula)
    if why:
        raise OpError(f"Fórmula rechazada ({why}).")
    min_col, min_row, max_col, max_row = range_boundaries(rng)
    origin = f"{get_column_letter(min_col)}{min_row}"
    tr = Translator(a.formula, origin=origin)
    n = 0
    for cell in _cells(ws, rng):
        f = a.formula if cell.coordinate == origin else tr.translate_formula(cell.coordinate)
        cell.value = f
        if a.number_format:
            cell.number_format = a.number_format
        n += 1
    last = f"{get_column_letter(max_col)}{max_row}"
    expected_last = Translator(a.formula, origin=origin).translate_formula(last) if last != origin else a.formula
    ctx.check(f"{ws.title}!{origin}:{last} contiene fórmulas rellenadas", lambda w, s=ws.title, o=origin, l=last, f1=a.formula, fl=expected_last: w[s][o].value == f1 and w[s][l].value == fl)
    return f"Fórmula {a.formula} rellenada en {ws.title}!{rng} ({n} celdas)."


# --------------------------------------------------------------------------- #
# Formato
# --------------------------------------------------------------------------- #
class FormatRange(Args):
    sheet: str
    range: str
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    font_color: Optional[str] = None
    font_size: Optional[float] = None
    font_name: Optional[str] = None
    fill_color: Optional[str] = None
    number_format: Optional[str] = Field(None, description="'0.00', '#,##0.00 €', '0%', 'dd/mm/yyyy', '@'…")
    h_align: Optional[Literal["left", "center", "right", "justify"]] = None
    v_align: Optional[Literal["top", "center", "bottom"]] = None
    wrap: Optional[bool] = None
    border: Optional[Literal["none", "thin", "medium", "thick", "double"]] = None
    outline_only: bool = Field(False, description="Si true, el borde solo rodea el rango")


@register("xlsx.format_range", "xlsx", FormatRange, "Aplica formato a un rango: fuente, color, relleno, formato numérico, alineación, ajuste de texto y bordes.")
def xlsx_format_range(ctx: ExecContext, a: FormatRange) -> str:
    ws = sheet(ctx, a.sheet)
    rng = check_ref(a.range)
    fc, fill = _rgb(a.font_color), _rgb(a.fill_color)
    min_col, min_row, max_col, max_row = range_boundaries(rng)
    for cell in _cells(ws, rng):
        if any(v is not None for v in (a.bold, a.italic, fc, a.font_size, a.font_name)):
            f = cell.font
            cell.font = Font(name=a.font_name or f.name, size=a.font_size or f.size, bold=f.bold if a.bold is None else a.bold,
                             italic=f.italic if a.italic is None else a.italic, color=fc or f.color, underline=f.underline)
        if fill:
            cell.fill = PatternFill("solid", fgColor=fill)
        if a.number_format:
            cell.number_format = a.number_format
        if a.h_align or a.v_align or a.wrap is not None:
            al = cell.alignment
            cell.alignment = Alignment(horizontal=a.h_align or al.horizontal, vertical=a.v_align or al.vertical,
                                       wrap_text=al.wrap_text if a.wrap is None else a.wrap)
        if a.border:
            side = Side(style=None if a.border == "none" else a.border, color="000000")
            if a.outline_only:
                b = cell.border
                cell.border = Border(left=side if cell.column == min_col else b.left, right=side if cell.column == max_col else b.right,
                                     top=side if cell.row == min_row else b.top, bottom=side if cell.row == max_row else b.bottom)
            else:
                cell.border = Border(left=side, right=side, top=side, bottom=side)
    first = f"{get_column_letter(min_col)}{min_row}"
    if a.bold is not None:
        ctx.check(f"{ws.title}!{first} en negrita={a.bold}", lambda w, s=ws.title, r=first, b=a.bold: bool(w[s][r].font.b) == b)
    if fill:
        ctx.check(f"{ws.title}!{first} con relleno {fill}", lambda w, s=ws.title, r=first, c=fill: str(w[s][r].fill.fgColor.rgb).upper().endswith(c))
    if a.number_format:
        ctx.check(f"{ws.title}!{first} con formato {a.number_format}", lambda w, s=ws.title, r=first, nf=a.number_format: w[s][r].number_format == nf)
    return f"Formato aplicado a {ws.title}!{rng}."


class ColumnWidth(Args):
    column: str = Field(..., description="Letra de columna")
    width: float


class SetDimensions(Args):
    sheet: str
    columns: list[ColumnWidth] = Field(default_factory=list)
    autofit_columns: Optional[str] = Field(None, description="Rango de columnas a autoajustar, p.ej. 'A:F'")
    row_heights: list[list[float]] = Field(default_factory=list, description="Pares [fila, alto]")


@register("xlsx.set_dimensions", "xlsx", SetDimensions, "Ajusta anchos de columna (manual o automático) y altos de fila.")
def xlsx_set_dimensions(ctx: ExecContext, a: SetDimensions) -> str:
    ws = sheet(ctx, a.sheet)
    for cw in a.columns:
        if not re.fullmatch(r"[A-Za-z]{1,3}", cw.column):
            raise OpError(f"Columna no válida: {cw.column}")
        ws.column_dimensions[cw.column.upper()].width = cw.width
    if a.autofit_columns:
        m = re.fullmatch(r"([A-Za-z]{1,3}):([A-Za-z]{1,3})", a.autofit_columns.strip())
        if not m:
            raise OpError("autofit_columns debe ser del tipo 'A:F'.")
        _autofit(ws, column_index_from_string(m.group(1).upper()), column_index_from_string(m.group(2).upper()))
    for pair in a.row_heights:
        if len(pair) != 2:
            raise OpError("row_heights: cada elemento debe ser [fila, alto].")
        ws.row_dimensions[int(pair[0])].height = pair[1]
    return f"Dimensiones ajustadas en «{ws.title}»."


class Merge(Args):
    sheet: str
    range: str
    unmerge: bool = False


@register("xlsx.merge_cells", "xlsx", Merge, "Combina (o separa) celdas de un rango.")
def xlsx_merge(ctx: ExecContext, a: Merge) -> str:
    ws = sheet(ctx, a.sheet)
    rng = check_ref(a.range)
    if a.unmerge:
        ws.unmerge_cells(rng)
        return f"Celdas {rng} separadas."
    ws.merge_cells(rng)
    ctx.check(f"{ws.title}!{rng} combinadas", lambda w, s=ws.title, r=rng: any(str(m) == r for m in w[s].merged_cells.ranges))
    return f"Celdas {ws.title}!{rng} combinadas."


# --------------------------------------------------------------------------- #
# Gráficos
# --------------------------------------------------------------------------- #
class AddChart(Args):
    sheet: str = Field(..., description="Hoja donde se coloca el gráfico")
    chart_type: Literal["column", "bar", "line", "pie", "doughnut", "scatter", "area"] = "column"
    data_sheet: Optional[str] = Field(None, description="Hoja de los datos (por defecto la misma)")
    data_range: str = Field(..., description="Rango de valores (columnas = series), incluyendo la fila de cabecera si titles_from_data")
    categories_range: Optional[str] = Field(None, description="Rango de etiquetas/categorías (eje X)")
    titles_from_data: bool = True
    title: str = ""
    x_title: str = ""
    y_title: str = ""
    anchor: str = Field("H2", description="Celda superior izquierda donde se coloca")
    width_cm: float = 16
    height_cm: float = 8.5
    stacked: bool = False
    show_data_labels: bool = False


@register("xlsx.add_chart", "xlsx", AddChart, "Inserta un gráfico nativo de Excel (columnas, barras, líneas, circular, anillo, dispersión, área) a partir de rangos de la hoja.")
def xlsx_add_chart(ctx: ExecContext, a: AddChart) -> str:
    ws = sheet(ctx, a.sheet)
    dws = sheet(ctx, a.data_sheet) if a.data_sheet else ws
    data_rng = check_ref(a.data_range)
    min_col, min_row, max_col, max_row = range_boundaries(data_rng)
    cls = {"column": BarChart, "bar": BarChart, "line": LineChart, "pie": PieChart, "doughnut": DoughnutChart, "scatter": ScatterChart, "area": AreaChart}[a.chart_type]
    ch = cls()
    if a.chart_type == "bar":
        ch.type = "bar"
    elif a.chart_type == "column":
        ch.type = "col"
    if a.stacked and a.chart_type in ("column", "bar", "area"):
        ch.grouping = "stacked"
        ch.overlap = 100
    if a.chart_type == "scatter":
        if not a.categories_range:
            raise OpError("Un gráfico de dispersión necesita categories_range (valores X).")
        c1, r1, c2, r2 = range_boundaries(check_ref(a.categories_range))
        xref = Reference(dws, min_col=c1, min_row=r1, max_col=c2, max_row=r2)
        for col in range(min_col, max_col + 1):
            yref = Reference(dws, min_col=col, min_row=min_row + (1 if a.titles_from_data else 0), max_row=max_row)
            s = Series(yref, xref, title=str(dws.cell(min_row, col).value) if a.titles_from_data else None)
            s.marker.symbol = "circle"
            s.graphicalProperties.line.noFill = True
            ch.series.append(s)
    else:
        data = Reference(dws, min_col=min_col, min_row=min_row, max_col=max_col, max_row=max_row)
        ch.add_data(data, titles_from_data=a.titles_from_data)
        if a.categories_range:
            c1, r1, c2, r2 = range_boundaries(check_ref(a.categories_range))
            ch.set_categories(Reference(dws, min_col=c1, min_row=r1, max_col=c2, max_row=r2))
    if a.title:
        ch.title = a.title
    if a.chart_type not in ("pie", "doughnut"):
        if a.x_title:
            ch.x_axis.title = a.x_title
        if a.y_title:
            ch.y_axis.title = a.y_title
        # Mostrar ejes (en versiones recientes de openpyxl se ocultan por defecto)
        try:
            ch.x_axis.delete = False
            ch.y_axis.delete = False
        except AttributeError:
            pass
    if a.show_data_labels:
        from openpyxl.chart.label import DataLabelList

        ch.dataLabels = DataLabelList()
        ch.dataLabels.showVal = a.chart_type not in ("pie", "doughnut")
        ch.dataLabels.showPercent = a.chart_type in ("pie", "doughnut")
    ch.width = a.width_cm
    ch.height = a.height_cm
    ws.add_chart(ch, check_ref(a.anchor, "cell"))
    count = ctx.state.setdefault("charts", {}).get(ws.title, 0) + 1
    ctx.state["charts"][ws.title] = count
    base_charts = 0
    if ctx.base_structure:
        for sh in ctx.base_structure.get("sheets", []):
            if sh["name"] == ws.title:
                base_charts = sh.get("charts", 0)
    need = count + base_charts
    ctx.check(f"La hoja «{ws.title}» contiene {need} gráfico(s)", lambda w, s=ws.title, n=need: s in w.sheetnames and len(w[s]._charts) >= n)
    return f"Gráfico de tipo {a.chart_type} «{a.title}» insertado en {ws.title}!{a.anchor} con datos {dws.title}!{data_rng}."


# --------------------------------------------------------------------------- #
# Formato condicional, validación, utilidades
# --------------------------------------------------------------------------- #
class CondFormat(Args):
    sheet: str
    range: str
    kind: Literal["cell_is", "formula", "color_scale", "data_bar", "text_contains"]
    operator: Optional[Literal["greaterThan", "lessThan", "between", "equal", "greaterThanOrEqual", "lessThanOrEqual", "notEqual"]] = None
    values: list[str] = Field(default_factory=list, description="Valores o fórmulas de comparación (como texto)")
    formula: Optional[str] = Field(None, description="Para kind=formula, p.ej. '=$C2<5'")
    text: Optional[str] = None
    fill_color: Optional[str] = "FFC7CE"
    font_color: Optional[str] = None


@register("xlsx.conditional_format", "xlsx", CondFormat, "Añade formato condicional: comparación de valores, fórmula, texto contiene, escala de color o barras de datos.")
def xlsx_conditional(ctx: ExecContext, a: CondFormat) -> str:
    ws = sheet(ctx, a.sheet)
    rng = check_ref(a.range)
    fill = PatternFill("solid", start_color=_rgb(a.fill_color), end_color=_rgb(a.fill_color)) if a.fill_color else None
    font = Font(color=_rgb(a.font_color)) if a.font_color else None
    for v in a.values + ([a.formula] if a.formula else []):
        why = check_formula(str(v))
        if why:
            raise OpError(f"Condición rechazada ({why}).")
    if a.kind == "cell_is":
        if not a.operator or not a.values:
            raise OpError("cell_is necesita operator y values.")
        rule = CellIsRule(operator=a.operator, formula=a.values, fill=fill, font=font)
    elif a.kind == "formula":
        if not a.formula:
            raise OpError("Falta formula.")
        rule = FormulaRule(formula=[a.formula.lstrip("=")], fill=fill, font=font)
    elif a.kind == "text_contains":
        if not a.text:
            raise OpError("Falta text.")
        first = rng.split(":")[0]
        safe = a.text.replace('"', '""')
        rule = FormulaRule(formula=[f'NOT(ISERROR(SEARCH("{safe}",{first})))'], fill=fill, font=font)
    elif a.kind == "color_scale":
        rule = ColorScaleRule(start_type="min", start_color="F8696B", mid_type="percentile", mid_value=50, mid_color="FFEB84", end_type="max", end_color="63BE7B")
    else:
        rule = DataBarRule(start_type="min", end_type="max", color="638EC6")
    ws.conditional_formatting.add(rng, rule)
    ctx.check(f"{ws.title}!{rng} tiene formato condicional", lambda w, s=ws.title, r=rng: any(str(cf.sqref) == r for cf in w[s].conditional_formatting))
    return f"Formato condicional ({a.kind}) en {ws.title}!{rng}."


class Validation(Args):
    sheet: str
    range: str
    kind: Literal["list", "whole", "decimal", "date", "text_length"]
    options: list[str] = Field(default_factory=list, description="Opciones para kind=list")
    operator: Literal["between", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual", "equal"] = "between"
    min: Optional[str] = None
    max: Optional[str] = None
    input_message: Optional[str] = None
    error_message: Optional[str] = None


@register("xlsx.data_validation", "xlsx", Validation, "Añade validación de datos (lista desplegable, número entero/decimal, fecha o longitud de texto) a un rango.")
def xlsx_validation(ctx: ExecContext, a: Validation) -> str:
    ws = sheet(ctx, a.sheet)
    rng = check_ref(a.range)
    if a.kind == "list":
        if not a.options:
            raise OpError("Una lista necesita opciones.")
        joined = ",".join(o.replace('"', "") for o in a.options)
        if len(joined) > 250:
            raise OpError("Demasiadas opciones para una lista desplegable.")
        dv = DataValidation(type="list", formula1=f'"{joined}"', allow_blank=True)
    else:
        typ = {"text_length": "textLength"}.get(a.kind, a.kind)
        dv = DataValidation(type=typ, operator=a.operator, formula1=a.min, formula2=a.max if a.operator == "between" else None, allow_blank=True)
    if a.input_message:
        dv.prompt = a.input_message
        dv.showInputMessage = True
    if a.error_message:
        dv.error = a.error_message
        dv.showErrorMessage = True
    ws.add_data_validation(dv)
    dv.add(rng)
    ctx.check(f"{ws.title}!{rng} tiene validación de datos", lambda w, s=ws.title, r=rng: any(r in str(d.sqref) for d in w[s].data_validations.dataValidation))
    return f"Validación ({a.kind}) en {ws.title}!{rng}."


class Freeze(Args):
    sheet: str
    cell: Optional[str] = Field("A2", description="Celda bajo/derecha de lo que se inmoviliza; null para quitar")


@register("xlsx.freeze_panes", "xlsx", Freeze, "Inmoviliza filas/columnas (p.ej. A2 inmoviliza la primera fila).")
def xlsx_freeze(ctx: ExecContext, a: Freeze) -> str:
    ws = sheet(ctx, a.sheet)
    ws.freeze_panes = check_ref(a.cell, "cell") if a.cell else None
    return f"Paneles inmovilizados en {ws.title}!{a.cell}."


class AutoFilter(Args):
    sheet: str
    range: str


@register("xlsx.autofilter", "xlsx", AutoFilter, "Activa autofiltro en un rango con cabecera.")
def xlsx_autofilter(ctx: ExecContext, a: AutoFilter) -> str:
    ws = sheet(ctx, a.sheet)
    ws.auto_filter.ref = check_ref(a.range)
    ctx.check(f"Autofiltro en {ws.title}", lambda w, s=ws.title: bool(w[s].auto_filter.ref))
    return f"Autofiltro en {ws.title}!{a.range}."


class DefineName(Args):
    name: str = Field(..., description="Nombre (sin espacios)")
    sheet: str
    range: str


@register("xlsx.define_name", "xlsx", DefineName, "Crea un nombre definido (rango con nombre) utilizable en fórmulas.")
def xlsx_define_name(ctx: ExecContext, a: DefineName) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,254}", a.name):
        raise OpError("Nombre no válido.")
    ws = sheet(ctx, a.sheet)
    min_col, min_row, max_col, max_row = range_boundaries(check_ref(a.range))
    ref = f"'{ws.title}'!${get_column_letter(min_col)}${min_row}:${get_column_letter(max_col)}${max_row}"
    ctx.obj.defined_names[a.name] = DefinedName(a.name, attr_text=ref)
    ctx.check(f"Existe el nombre definido «{a.name}»", lambda w, n=a.name: n in w.defined_names)
    return f"Nombre «{a.name}» → {ref}."


class ImportCsv(Args):
    file_id: str
    sheet: str
    top_left: str = "A1"
    header_bold: bool = True


def parse_number(s: str):
    t = s.strip()
    if re.fullmatch(r"-?\d+", t):
        return int(t)
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", t):  # 1.234,56
        return float(t.replace(".", "").replace(",", "."))
    if re.fullmatch(r"-?\d+,\d+", t):
        return float(t.replace(",", "."))
    if re.fullmatch(r"-?\d+\.\d+", t) or re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", t):
        return float(t.replace(",", ""))
    return s


@register("xlsx.import_csv", "xlsx", ImportCsv, "Importa un CSV subido a una hoja, convirtiendo números (también con coma decimal).")
def xlsx_import_csv(ctx: ExecContext, a: ImportCsv) -> str:
    from ..ingest.other import decode_text, sniff_csv

    path = ctx.input_path(a.file_id, ("csv", "txt"))
    rows, _ = sniff_csv(decode_text(path.read_bytes()))
    ws = sheet(ctx, a.sheet)
    tl = check_ref(a.top_left, "cell")
    col0 = column_index_from_string(re.match(r"[A-Z]+", tl).group(0))
    row0 = int(re.search(r"\d+", tl).group(0))
    for r_i, row in enumerate(rows):
        for c_i, v in enumerate(row):
            val = parse_number(v) if r_i > 0 or not a.header_bold else v
            if isinstance(val, str) and val.startswith("="):
                val = "'" + val  # nunca ejecutar fórmulas venidas de un CSV
            cell = ws.cell(row=row0 + r_i, column=col0 + c_i, value=val)
            if r_i == 0 and a.header_bold:
                cell.font = Font(bold=True)
    if rows:
        _autofit(ws, col0, col0 + max(len(r) for r in rows) - 1)
    return f"Importadas {len(rows)} filas del CSV en «{ws.title}»."


class SortRows(Args):
    sheet: str
    range: str = Field(..., description="Rango de datos incluyendo cabecera si has_header")
    by_column: str = Field(..., description="Letra de la columna por la que ordenar")
    descending: bool = False
    has_header: bool = True


@register("xlsx.sort_range", "xlsx", SortRows, "Ordena las filas de un rango de valores (no admite rangos con fórmulas).")
def xlsx_sort(ctx: ExecContext, a: SortRows) -> str:
    ws = sheet(ctx, a.sheet)
    min_col, min_row, max_col, max_row = range_boundaries(check_ref(a.range))
    start = min_row + (1 if a.has_header else 0)
    key_col = column_index_from_string(a.by_column.upper()) - min_col
    if not 0 <= key_col <= max_col - min_col:
        raise OpError("La columna de ordenación está fuera del rango.")
    data = [[ws.cell(r, c).value for c in range(min_col, max_col + 1)] for r in range(start, max_row + 1)]
    if any(isinstance(v, str) and v.startswith("=") for row in data for v in row):
        raise OpError("El rango contiene fórmulas; ordénalo antes de añadirlas.")
    def sort_key(row):
        v = row[key_col]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return (0, v, "")
        return (1, 0, str(v).lower()) if v is not None else (2, 0, "")

    non_empty = [r for r in data if r[key_col] is not None]
    empty = [r for r in data if r[key_col] is None]
    non_empty.sort(key=sort_key, reverse=a.descending)
    data = non_empty + empty
    for i, row in enumerate(data):
        for j, v in enumerate(row):
            ws.cell(start + i, min_col + j).value = v
    return f"Rango ordenado por la columna {a.by_column} ({'desc' if a.descending else 'asc'})."


class PrintSetup(Args):
    sheet: str
    orientation: Literal["portrait", "landscape"] = "portrait"
    fit_to_width: bool = True
    print_area: Optional[str] = None
    header_center: Optional[str] = None
    footer_center: Optional[str] = None


@register("xlsx.page_setup", "xlsx", PrintSetup, "Configura la impresión: orientación, ajustar a una página de ancho, área de impresión y encabezado/pie.")
def xlsx_page_setup(ctx: ExecContext, a: PrintSetup) -> str:
    ws = sheet(ctx, a.sheet)
    ws.page_setup.orientation = a.orientation
    if a.fit_to_width:
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
    if a.print_area:
        ws.print_area = check_ref(a.print_area)
    if a.header_center:
        ws.oddHeader.center.text = a.header_center
    if a.footer_center:
        ws.oddFooter.center.text = a.footer_center
    return f"Configuración de impresión de «{ws.title}» aplicada."
