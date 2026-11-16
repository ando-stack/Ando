"""Herramientas DOCX: creación y edición real con python-docx, conservando
plantillas (estilos, encabezados, tablas) siempre que sea posible."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Literal, Optional

import docx
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from pydantic import Field

from .base import Args, Block, ExecContext, OpError, markup_runs, register, render_chart_png, strip_markup

ALIGN = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT, "justify": WD_ALIGN_PARAGRAPH.JUSTIFY}


# --------------------------------------------------------------------------- #
# Ciclo de vida
# --------------------------------------------------------------------------- #
def open_doc(ctx: ExecContext, base: Path | None) -> None:
    ctx.obj = docx.Document(str(base)) if base else docx.Document()
    ctx.state["paras"] = list(ctx.obj.paragraphs)
    ctx.state["tables"] = list(ctx.obj.tables)
    ctx.state["last_after"] = {}


def save_doc(ctx: ExecContext) -> None:
    ctx.obj.save(str(ctx.out_path))


def reopen(path: Path):
    return docx.Document(str(path))


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def iter_paragraphs(doc, include_headers: bool = True):
    def from_tables(tables):
        for t in tables:
            for row in t.rows:
                for cell in row.cells:
                    yield from cell.paragraphs
                    yield from from_tables(cell.tables)

    yield from doc.paragraphs
    yield from from_tables(doc.tables)
    if include_headers:
        for s in doc.sections:
            for part in (s.header, s.footer, s.first_page_header, s.first_page_footer):
                if part is not None and not part.is_linked_to_previous:
                    yield from part.paragraphs
                    yield from from_tables(part.tables)


def full_text(doc) -> str:
    seen = set()
    out = []
    for p in iter_paragraphs(doc):
        if p._p in seen:
            continue
        seen.add(p._p)
        out.append(p.text)
    return "\n".join(out)


def _split_run(run: Run, offset: int) -> Run:
    new_r = copy.deepcopy(run._r)
    run._r.addnext(new_r)
    new_run = Run(new_r, run._parent)
    t = run.text
    run.text = t[:offset]
    new_run.text = t[offset:]
    return new_run


def isolate(p: Paragraph, start: int, end: int) -> list[Run]:
    """Divide los runs para que [start, end) quede cubierto exactamente por runs propios."""
    pos = 0
    for run in list(p.runs):
        t = run.text
        r_start, r_end = pos, pos + len(t)
        if r_start < start < r_end:
            _split_run(run, start - r_start)
            return isolate(p, start, end)
        if r_start < end < r_end:
            _split_run(run, end - r_start)
            return isolate(p, start, end)
        pos = r_end
    result, pos = [], 0
    for run in p.runs:
        t = run.text
        if pos >= start and pos + len(t) <= end and t:
            result.append(run)
        pos += len(t)
    return result


def _find_all(text: str, find: str, case: bool) -> list[int]:
    hay, needle = (text, find) if case else (text.lower(), find.lower())
    out, i = [], hay.find(needle)
    while i != -1 and needle:
        out.append(i)
        i = hay.find(needle, i + len(needle))
    return out


def replace_in_paragraph(p: Paragraph, find: str, repl: str, case: bool = True, limit: int | None = None) -> int:
    text = "".join(r.text for r in p.runs)
    positions = _find_all(text, find, case)
    if limit is not None:
        positions = positions[:limit]
    for start in reversed(positions):
        runs = isolate(p, start, start + len(find))
        if not runs:
            continue
        runs[0].text = repl
        for r in runs[1:]:
            r._r.getparent().remove(r._r)
    return len(positions)


def _rpr_of(p: Paragraph):
    for r in p.runs:
        if r._r.rPr is not None:
            return copy.deepcopy(r._r.rPr)
    return None


def write_markup(p: Paragraph, text: str, rpr=None) -> None:
    lines = text.split("\n")
    for li, line in enumerate(lines):
        for chunk, fmt in markup_runs(line):
            run = p.add_run(chunk)
            if rpr is not None:
                run._r.insert(0, copy.deepcopy(rpr))
            if fmt.get("bold"):
                run.bold = True
            if fmt.get("italic"):
                run.italic = True
            if fmt.get("underline"):
                run.underline = True
        if li < len(lines) - 1:
            p.add_run().add_break(WD_BREAK.LINE)


def set_paragraph_text(p: Paragraph, text: str) -> None:
    rpr = _rpr_of(p)
    for r in list(p._p):
        if r.tag in (qn("w:r"), qn("w:hyperlink")):
            p._p.remove(r)
    write_markup(p, text, rpr)


def _style_exists(doc, name: str) -> bool:
    try:
        doc.styles[name]
        return True
    except KeyError:
        return False


def _place(ctx: ExecContext, elements: list, after: Optional[int]) -> None:
    """Mueve los elementos recién añadidos al final del cuerpo a su posición."""
    if after is None:
        return
    paras = ctx.state["paras"]
    if after == -1:
        body = ctx.obj.element.body
        first = body[0]
        for el in elements:
            first.addprevious(el)
        return
    if not (0 <= after < len(paras)):
        raise OpError(f"El párrafo P{after} no existe (la plantilla tiene {len(paras)} párrafos).")
    anchor = ctx.state["last_after"].get(after, paras[after]._p)
    if anchor.getparent() is None:  # el párrafo de anclaje se borró y era el primero
        first = ctx.obj.element.body[0]
        for el in elements:
            first.addprevious(el)
        ctx.state["last_after"][after] = elements[-1] if elements else anchor
        return
    for el in elements:
        anchor.addnext(el)
        anchor = el
    ctx.state["last_after"][after] = anchor


def add_block(ctx: ExecContext, b: Block) -> list:
    doc = ctx.obj
    els: list = []
    if b.type == "heading":
        text = b.text or ""
        level = min(max(b.level or 1, 1), 4)
        try:
            p = doc.add_heading("", level=level)
            write_markup(p, text)
        except KeyError:
            p = doc.add_paragraph()
            write_markup(p, text)
            for r in p.runs:
                r.bold = True
                r.font.size = Pt({1: 16, 2: 14, 3: 12, 4: 11}[level])
        if b.align:
            p.alignment = ALIGN[b.align]
        els.append(p._p)
        ctx.check(f"El título «{strip_markup(text)[:50]}» está en el documento", lambda d, t=strip_markup(text): t in full_text(d))
    elif b.type == "paragraph":
        text = b.text or ""
        style = b.style if b.style and _style_exists(doc, b.style) else None
        if b.style and not style:
            ctx.warnings.append(f"El estilo «{b.style}» no existe; se usó el estilo normal.")
        p = doc.add_paragraph(style=style)
        write_markup(p, text)
        if b.align:
            p.alignment = ALIGN[b.align]
        els.append(p._p)
        snippet = strip_markup(text).split("\n")[0][:60]
        ctx.check(f"El párrafo «{snippet}…» está en el documento", lambda d, t=snippet: t in full_text(d))
    elif b.type in ("bullets", "numbered"):
        style = "List Bullet" if b.type == "bullets" else "List Number"
        has_style = _style_exists(doc, style)
        for i, item in enumerate(b.items or []):
            p = doc.add_paragraph(style=style if has_style else None)
            prefix = "" if has_style else ("• " if b.type == "bullets" else f"{i + 1}. ")
            write_markup(p, prefix + item)
            els.append(p._p)
        if not b.items:
            raise OpError("La lista no tiene elementos.")
    elif b.type == "table":
        rows = b.rows or []
        if not rows:
            raise OpError("La tabla no tiene filas.")
        ncols = max(len(r) for r in rows)
        t = doc.add_table(rows=len(rows), cols=ncols)
        style = b.table_style or "Table Grid"
        if _style_exists(doc, style):
            t.style = doc.styles[style]
        elif b.table_style:
            ctx.warnings.append(f"El estilo de tabla «{b.table_style}» no existe en la plantilla.")
        for r_i, row in enumerate(rows):
            for c_i in range(ncols):
                cell = t.cell(r_i, c_i)
                cell.text = ""
                write_markup(cell.paragraphs[0], row[c_i] if c_i < len(row) else "")
                if b.header and r_i == 0:
                    for run in cell.paragraphs[0].runs:
                        run.bold = True
        if b.caption:
            cap = doc.add_paragraph(style="Caption" if _style_exists(doc, "Caption") else None)
            write_markup(cap, b.caption)
            els.extend([t._tbl, cap._p])
        else:
            els.append(t._tbl)
        ctx.state["tables"].append(t)
        expected = len(rows)
        first = strip_markup(rows[0][0]) if rows[0] else ""
        ctx.check(f"Existe una tabla de {expected}×{ncols} que empieza por «{first[:30]}»",
                  lambda d, n=expected, c=ncols, f=first: any(len(tb.rows) == n and len(tb.columns) == c and tb.cell(0, 0).text.strip() == f.strip() for tb in d.tables))
    elif b.type in ("image", "chart"):
        if b.type == "image":
            if not b.file_id:
                raise OpError("Falta file_id de la imagen.")
            img = ctx.input_path(b.file_id, ("image",))
        else:
            if b.chart is None:
                raise OpError("Falta la especificación del gráfico.")
            n = ctx.state.setdefault("chart_n", 0) + 1
            ctx.state["chart_n"] = n
            img = render_chart_png(b.chart, ctx.work_dir / f"chart_{ctx.out_path.stem}_{n}.png")
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(str(img), width=Cm(min(b.width_cm or 15, 17)))
        els.append(p._p)
        if b.caption:
            cap = doc.add_paragraph(style="Caption" if _style_exists(doc, "Caption") else None)
            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            write_markup(cap, b.caption)
            els.append(cap._p)
        ctx.state["images_added"] = ctx.state.get("images_added", 0) + 1
        need = ctx.state["images_added"]
        ctx.check(f"El documento contiene al menos {need} imagen(es) insertada(s)", lambda d, n=need: len(d.inline_shapes) >= n)
    elif b.type == "page_break":
        p = doc.add_paragraph()
        p.add_run().add_break(WD_BREAK.PAGE)
        els.append(p._p)
    elif b.type == "toc":
        p = doc.add_paragraph()
        _add_field(p, 'TOC \\o "1-3" \\h \\z \\u', "Índice: haz clic derecho › Actualizar campo")
        settings_el = doc.settings.element
        upd = settings_el.find(qn("w:updateFields"))
        if upd is None:
            upd = OxmlElement("w:updateFields")
            settings_el.append(upd)
        upd.set(qn("w:val"), "true")
        els.append(p._p)
        ctx.warnings.append("El índice es un campo de Word: al abrir el documento, acepta «actualizar campos» para rellenarlo.")
    return els


def _add_field(p: Paragraph, instr: str, placeholder: str = "") -> None:
    def el(tag, **attrs):
        e = OxmlElement(tag)
        for k, v in attrs.items():
            e.set(qn(k), v)
        return e

    r1 = p.add_run()
    r1._r.append(el("w:fldChar", **{"w:fldCharType": "begin"}))
    r2 = p.add_run()
    it = el("w:instrText", **{"xml:space": "preserve"})
    it.text = instr
    r2._r.append(it)
    r3 = p.add_run()
    r3._r.append(el("w:fldChar", **{"w:fldCharType": "separate"}))
    p.add_run(placeholder)
    r5 = p.add_run()
    r5._r.append(el("w:fldChar", **{"w:fldCharType": "end"}))


# --------------------------------------------------------------------------- #
# Operaciones registradas
# --------------------------------------------------------------------------- #
class ReplaceText(Args):
    find: str = Field(..., min_length=1, description="Texto exacto a buscar (p.ej. un hueco '________' o '[Nombre]')")
    replace: str = Field(..., description="Texto nuevo")
    match_case: bool = True
    max_count: Optional[int] = Field(None, description="Máximo de sustituciones (null = todas)")


@register("docx.replace_text", "docx", ReplaceText,
          "Busca y reemplaza texto en todo el documento (cuerpo, tablas, encabezados y pies) conservando el formato original. Ideal para rellenar huecos de plantillas.")
def docx_replace_text(ctx: ExecContext, a: ReplaceText) -> str:
    total = 0
    seen = set()
    for p in iter_paragraphs(ctx.obj):
        if p._p in seen:
            continue
        seen.add(p._p)
        remaining = None if a.max_count is None else a.max_count - total
        if remaining is not None and remaining <= 0:
            break
        total += replace_in_paragraph(p, a.find, a.replace, a.match_case, remaining)
    if total == 0:
        raise OpError(f"No se encontró el texto «{a.find}» en el documento.")
    if a.replace:
        ctx.check(f"Aparece «{a.replace[:50]}» en lugar de «{a.find[:30]}»", lambda d, r=a.replace: r.split("\n")[0] in full_text(d))
    return f"Sustituido «{a.find}» → «{a.replace[:60]}» ({total} vez/veces)."


class SetParagraph(Args):
    index: int = Field(..., description="Índice Pn del párrafo original de la plantilla")
    text: str
    style: Optional[str] = None


@register("docx.set_paragraph", "docx", SetParagraph, "Reescribe el texto de un párrafo existente (Pn) manteniendo su formato y estilo.")
def docx_set_paragraph(ctx: ExecContext, a: SetParagraph) -> str:
    paras = ctx.state["paras"]
    if not 0 <= a.index < len(paras):
        raise OpError(f"El párrafo P{a.index} no existe.")
    p = paras[a.index]
    set_paragraph_text(p, a.text)
    if a.style:
        if _style_exists(ctx.obj, a.style):
            p.style = ctx.obj.styles[a.style]
        else:
            ctx.warnings.append(f"Estilo «{a.style}» inexistente; se mantuvo el original.")
    snippet = strip_markup(a.text).split("\n")[0][:60]
    ctx.check(f"El párrafo P{a.index} contiene «{snippet}»", lambda d, t=snippet: t in full_text(d))
    return f"Párrafo P{a.index} reescrito."


class AddContent(Args):
    after_paragraph: Optional[int] = Field(None, description="Insertar tras el párrafo Pn original; -1 = al principio; null = al final")
    blocks: list[Block] = Field(..., min_length=1)


@register("docx.add_content", "docx", AddContent,
          "Inserta bloques (títulos, párrafos, listas, tablas, imágenes subidas, gráficos, saltos de página, índice) en una posición del documento.")
def docx_add_content(ctx: ExecContext, a: AddContent) -> str:
    els = []
    for b in a.blocks:
        els.extend(add_block(ctx, b))
    _place(ctx, els, a.after_paragraph)
    where = "al final" if a.after_paragraph is None else ("al principio" if a.after_paragraph == -1 else f"tras P{a.after_paragraph}")
    kinds = ", ".join(sorted({b.type for b in a.blocks}))
    return f"Añadidos {len(a.blocks)} bloque(s) ({kinds}) {where}."


class FillCell(Args):
    table: int = Field(..., description="Índice Tn de la tabla")
    row: int
    col: int
    text: str
    mode: Literal["replace", "append"] = "replace"


@register("docx.fill_table_cell", "docx", FillCell, "Escribe en una celda de una tabla existente (Tn Rr Cc) respetando el formato de la celda.")
def docx_fill_cell(ctx: ExecContext, a: FillCell) -> str:
    tables = ctx.state["tables"]
    if not 0 <= a.table < len(tables):
        raise OpError(f"La tabla T{a.table} no existe.")
    t = tables[a.table]
    try:
        cell = t.cell(a.row, a.col)
    except IndexError as e:
        raise OpError(f"La celda R{a.row} C{a.col} no existe en T{a.table}.") from e
    if a.mode == "append" and cell.text.strip():
        p = cell.add_paragraph()
        write_markup(p, a.text, _rpr_of(cell.paragraphs[0]))
    else:
        first = cell.paragraphs[0]
        for extra in cell.paragraphs[1:]:
            extra._p.getparent().remove(extra._p)
        set_paragraph_text(first, a.text)
    snippet = strip_markup(a.text).split("\n")[0][:40]
    ctx.check(f"La celda T{a.table} R{a.row} C{a.col} contiene «{snippet}»", lambda d, ti=a.table, r=a.row, c=a.col, s=snippet: ti < len(d.tables) and s in d.tables[ti].cell(r, c).text)
    return f"Celda T{a.table} R{a.row} C{a.col} rellenada."


class AddRows(Args):
    table: int
    rows: list[list[str]] = Field(..., min_length=1)


@register("docx.add_table_rows", "docx", AddRows, "Añade filas al final de una tabla existente copiando el formato de su última fila.")
def docx_add_rows(ctx: ExecContext, a: AddRows) -> str:
    tables = ctx.state["tables"]
    if not 0 <= a.table < len(tables):
        raise OpError(f"La tabla T{a.table} no existe.")
    t = tables[a.table]
    template = t.rows[-1]._tr
    before = len(t.rows)
    for values in a.rows:
        new_tr = copy.deepcopy(template)
        t._tbl.append(new_tr)
        row = t.rows[-1]
        for c, cell in enumerate(row.cells):
            first = cell.paragraphs[0]
            for extra in cell.paragraphs[1:]:
                extra._p.getparent().remove(extra._p)
            set_paragraph_text(first, values[c] if c < len(values) else "")
    expected = before + len(a.rows)
    ctx.check(f"La tabla T{a.table} tiene {expected} filas", lambda d, ti=a.table, n=expected: ti < len(d.tables) and len(d.tables[ti].rows) == n)
    return f"Añadidas {len(a.rows)} fila(s) a T{a.table}."


class DeleteParagraph(Args):
    index: int


@register("docx.delete_paragraph", "docx", DeleteParagraph, "Elimina un párrafo original (por ejemplo, instrucciones que el profesor pide borrar antes de entregar).")
def docx_delete_paragraph(ctx: ExecContext, a: DeleteParagraph) -> str:
    paras = ctx.state["paras"]
    if not 0 <= a.index < len(paras):
        raise OpError(f"El párrafo P{a.index} no existe.")
    p = paras[a.index]
    if p._p.getparent() is None:
        raise OpError(f"El párrafo P{a.index} ya fue eliminado.")
    text = p.text
    # Lo insertado "tras P{index}" se colocará donde estaba el párrafo borrado.
    prev = p._p.getprevious()
    if a.index in ctx.state["last_after"]:
        pass
    elif prev is not None:
        ctx.state["last_after"][a.index] = prev
    p._p.getparent().remove(p._p)
    snippet = text.strip()[:50]
    if snippet:
        ctx.check(f"Se eliminó el párrafo «{snippet}»", lambda d, s=snippet: s not in "\n".join(x.text for x in d.paragraphs))
    return f"Eliminado el párrafo P{a.index}."


class HeaderFooter(Args):
    header: Optional[str] = None
    footer: Optional[str] = None
    page_numbers: bool = Field(False, description="Añade 'Página N' al pie")
    align: Literal["left", "center", "right"] = "center"


@register("docx.set_header_footer", "docx", HeaderFooter, "Define el encabezado y/o pie de página de todas las secciones; opcionalmente numeración de páginas.")
def docx_header_footer(ctx: ExecContext, a: HeaderFooter) -> str:
    for s in ctx.obj.sections:
        if a.header is not None:
            s.header.is_linked_to_previous = False
            p = s.header.paragraphs[0]
            set_paragraph_text(p, a.header)
            p.alignment = ALIGN[a.align]
        if a.footer is not None or a.page_numbers:
            s.footer.is_linked_to_previous = False
            p = s.footer.paragraphs[0]
            set_paragraph_text(p, a.footer or "")
            p.alignment = ALIGN[a.align]
            if a.page_numbers:
                p.add_run(("  ·  " if a.footer else "") + "Página ")
                _add_field(p, "PAGE", "1")
    if a.header:
        ctx.check("El encabezado contiene el texto pedido", lambda d, h=strip_markup(a.header): h in d.sections[0].header.paragraphs[0].text)
    if a.footer:
        ctx.check("El pie contiene el texto pedido", lambda d, f=strip_markup(a.footer): f in d.sections[0].footer.paragraphs[0].text)
    return "Encabezado/pie actualizados."


class FormatText(Args):
    find: str = Field(..., min_length=1)
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    underline: Optional[bool] = None
    color_hex: Optional[str] = Field(None, description="Color RRGGBB")
    highlight: Optional[Literal["yellow", "green", "cyan", "pink", "gray"]] = None
    font: Optional[str] = None
    size_pt: Optional[float] = None


HIGHLIGHT = {"yellow": 7, "green": 4, "cyan": 3, "pink": 5, "gray": 16}


@register("docx.format_text", "docx", FormatText, "Aplica formato (negrita, cursiva, subrayado, color, resaltado, fuente, tamaño) a todas las apariciones de un texto.")
def docx_format_text(ctx: ExecContext, a: FormatText) -> str:
    from docx.enum.text import WD_COLOR_INDEX

    count = 0
    seen = set()
    for p in iter_paragraphs(ctx.obj):
        if p._p in seen:
            continue
        seen.add(p._p)
        text = "".join(r.text for r in p.runs)
        for start in reversed(_find_all(text, a.find, True)):
            for run in isolate(p, start, start + len(a.find)):
                if a.bold is not None:
                    run.bold = a.bold
                if a.italic is not None:
                    run.italic = a.italic
                if a.underline is not None:
                    run.underline = a.underline
                if a.color_hex:
                    run.font.color.rgb = RGBColor.from_string(a.color_hex.strip("#").upper()[:6])
                if a.highlight:
                    run.font.highlight_color = WD_COLOR_INDEX(HIGHLIGHT[a.highlight])
                if a.font:
                    run.font.name = a.font
                if a.size_pt:
                    run.font.size = Pt(a.size_pt)
            count += 1
    if count == 0:
        raise OpError(f"No se encontró «{a.find}» para darle formato.")
    if a.bold:
        ctx.check(f"«{a.find[:40]}» está en negrita", lambda d, f=a.find: any(r.bold and f.startswith(r.text[:5]) for p in iter_paragraphs(d) for r in p.runs if r.text and r.text in f))
    return f"Formato aplicado a «{a.find[:50]}» ({count} vez/veces)."


class StyleFont(Args):
    style: str = Field("Normal", description="Nombre del estilo (Normal, Heading 1, …)")
    font: Optional[str] = None
    size_pt: Optional[float] = None
    color_hex: Optional[str] = None
    bold: Optional[bool] = None
    line_spacing: Optional[float] = Field(None, description="Interlineado (1.0, 1.15, 1.5, 2.0)")
    space_after_pt: Optional[float] = None
    align: Optional[Literal["left", "center", "right", "justify"]] = None


@register("docx.set_style", "docx", StyleFont, "Modifica un estilo del documento (fuente, tamaño, color, interlineado, alineación). Afecta a todo el texto con ese estilo.")
def docx_set_style(ctx: ExecContext, a: StyleFont) -> str:
    if not _style_exists(ctx.obj, a.style):
        raise OpError(f"El estilo «{a.style}» no existe.")
    st = ctx.obj.styles[a.style]
    if a.font:
        st.font.name = a.font
        rpr = st.element.get_or_add_rPr()
        fonts = rpr.find(qn("w:rFonts"))
        if fonts is None:
            fonts = OxmlElement("w:rFonts")
            rpr.append(fonts)
        for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            fonts.set(qn(attr), a.font)
    if a.size_pt:
        st.font.size = Pt(a.size_pt)
    if a.color_hex:
        st.font.color.rgb = RGBColor.from_string(a.color_hex.strip("#").upper()[:6])
    if a.bold is not None:
        st.font.bold = a.bold
    pf = getattr(st, "paragraph_format", None)
    if pf is not None:
        if a.line_spacing:
            pf.line_spacing = a.line_spacing
        if a.space_after_pt is not None:
            pf.space_after = Pt(a.space_after_pt)
        if a.align:
            pf.alignment = ALIGN[a.align]
    if a.font:
        ctx.check(f"El estilo {a.style} usa la fuente {a.font}", lambda d, s=a.style, f=a.font: d.styles[s].font.name == f)
    if a.size_pt:
        ctx.check(f"El estilo {a.style} tiene tamaño {a.size_pt} pt", lambda d, s=a.style, z=a.size_pt: d.styles[s].font.size is not None and abs(d.styles[s].font.size.pt - z) < 0.1)
    return f"Estilo «{a.style}» modificado."


class PageSetup(Args):
    orientation: Optional[Literal["portrait", "landscape"]] = None
    margins_cm: Optional[float] = Field(None, description="Margen en cm para los cuatro lados")


@register("docx.set_page", "docx", PageSetup, "Configura orientación y márgenes de página.")
def docx_set_page(ctx: ExecContext, a: PageSetup) -> str:
    for s in ctx.obj.sections:
        if a.orientation:
            want_land = a.orientation == "landscape"
            is_land = s.page_width > s.page_height
            if want_land != is_land:
                s.page_width, s.page_height = s.page_height, s.page_width
            s.orientation = WD_ORIENT.LANDSCAPE if want_land else WD_ORIENT.PORTRAIT
        if a.margins_cm is not None:
            m = Cm(a.margins_cm)
            s.left_margin = s.right_margin = s.top_margin = s.bottom_margin = m
    if a.orientation:
        ctx.check(f"Orientación {a.orientation}", lambda d, o=a.orientation: (d.sections[0].page_width > d.sections[0].page_height) == (o == "landscape"))
    return "Página configurada."


class Properties(Args):
    title: Optional[str] = None
    author: Optional[str] = None
    subject: Optional[str] = None


@register("docx.set_properties", "docx", Properties, "Rellena las propiedades del archivo (título, autor, asunto).")
def docx_set_properties(ctx: ExecContext, a: Properties) -> str:
    cp = ctx.obj.core_properties
    if a.title is not None:
        cp.title = a.title
    if a.author is not None:
        cp.author = a.author
    if a.subject is not None:
        cp.subject = a.subject
    return "Propiedades del documento actualizadas."
