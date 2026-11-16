"""Herramientas PPTX (python-pptx), PDF (ReportLab para crear, PyMuPDF para
rellenar/anotar) y CSV."""
from __future__ import annotations

import csv
import io
import shutil
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field

from .base import Args, Block, ChartSpec, ExecContext, OpError, markup_runs, register, render_chart_png, strip_markup

# =========================================================================== #
# PPTX
# =========================================================================== #
LAYOUT_HINTS = {
    "title": (["title slide", "diapositiva de título", "título"], 0),
    "title_content": (["title and content", "título y objetos", "título y contenido"], 1),
    "section": (["section header", "encabezado de sección"], 2),
    "two_content": (["two content", "dos objetos", "dos contenidos"], 3),
    "title_only": (["title only", "solo el título", "sólo el título"], 5),
    "blank": (["blank", "en blanco"], 6),
}


def open_prs(ctx: ExecContext, base: Path | None) -> None:
    from pptx import Presentation
    from pptx.util import Inches

    if base:
        ctx.obj = Presentation(str(base))
    else:
        prs = Presentation()
        prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
        ctx.obj = prs
    ctx.state["initial_slides"] = len(ctx.obj.slides)


def save_prs(ctx: ExecContext) -> None:
    ctx.obj.save(str(ctx.out_path))


def reopen_prs(path: Path):
    from pptx import Presentation

    return Presentation(str(path))


def _layout(prs, kind: str):
    names, idx = LAYOUT_HINTS[kind]
    for layout in prs.slide_layouts:
        if layout.name.lower() in names:
            return layout
    layouts = list(prs.slide_layouts)
    return layouts[min(idx, len(layouts) - 1)]


def _fill_tf(tf, lines: list[str], size=None) -> None:
    from pptx.util import Pt

    tf.clear()
    first = True
    for line in lines:
        level = 0
        while line.startswith("  ") and level < 4:
            line = line[2:]
            level += 1
        line = line.lstrip("-• ").rstrip() if line.lstrip().startswith(("- ", "• ")) else line
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.level = level
        for chunk, fmt in markup_runs(line):
            r = p.add_run()
            r.text = chunk
            if fmt.get("bold"):
                r.font.bold = True
            if fmt.get("italic"):
                r.font.italic = True
            if fmt.get("underline"):
                r.font.underline = True
            if size:
                r.font.size = Pt(size)


class SlideTable(Args):
    rows: list[list[str]]
    header: bool = True


class AddSlide(Args):
    layout: Literal["title", "title_content", "section", "two_content", "title_only", "blank"] = "title_content"
    title: str = ""
    subtitle: Optional[str] = None
    bullets: list[str] = Field(default_factory=list, description="Viñetas; sangra con dos espacios por nivel. Admite **negrita**")
    right_bullets: list[str] = Field(default_factory=list, description="Columna derecha (layout two_content)")
    image_file_id: Optional[str] = None
    table: Optional[SlideTable] = None
    chart: Optional[ChartSpec] = None
    notes: Optional[str] = Field(None, description="Notas del orador")


@register("pptx.add_slide", "pptx", AddSlide, "Añade una diapositiva con título, viñetas, imagen subida, tabla o gráfico nativo, y notas del orador.")
def pptx_add_slide(ctx: ExecContext, a: AddSlide) -> str:
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from pptx.util import Emu, Inches, Pt

    prs = ctx.obj
    slide = prs.slides.add_slide(_layout(prs, a.layout))
    if slide.shapes.title is not None:
        slide.shapes.title.text = a.title
    body_ph = [ph for ph in slide.placeholders if ph.placeholder_format.idx != 0]
    W, H = prs.slide_width, prs.slide_height
    top = Inches(1.6)
    area = (Inches(0.6), top, W - Inches(1.2), H - top - Inches(0.5))

    if a.layout == "title" and a.subtitle is not None and body_ph:
        body_ph[0].text = a.subtitle
        body_ph = body_ph[1:]
    if a.bullets:
        if body_ph:
            _fill_tf(body_ph[0].text_frame, a.bullets)
            body_ph = body_ph[1:]
        else:
            tb = slide.shapes.add_textbox(*area)
            tb.text_frame.word_wrap = True
            _fill_tf(tb.text_frame, a.bullets, 20)
    if a.right_bullets:
        if body_ph:
            _fill_tf(body_ph[0].text_frame, a.right_bullets)
            body_ph = body_ph[1:]
        else:
            tb = slide.shapes.add_textbox(W // 2, top, W // 2 - Inches(0.6), area[3])
            _fill_tf(tb.text_frame, a.right_bullets, 20)
    visual_area = area
    if a.bullets and (a.image_file_id or a.table or a.chart):
        visual_area = (W // 2, top, W // 2 - Inches(0.6), area[3])
    # Eliminar marcadores vacíos sobrantes para que no aparezca "Haga clic para agregar texto"
    for ph in body_ph:
        if ph.has_text_frame and not ph.text_frame.text.strip():
            ph._element.getparent().remove(ph._element)
    if a.image_file_id:
        from PIL import Image

        img = ctx.input_path(a.image_file_id, ("image",))
        with Image.open(img) as im:
            iw, ih = im.size
        x, y, w, h = visual_area
        scale = min(w / iw, h / ih)
        pw, ph_ = int(iw * scale), int(ih * scale)
        slide.shapes.add_picture(str(img), x + (w - pw) // 2, y + (h - ph_) // 2, Emu(pw), Emu(ph_))
    if a.table and a.table.rows:
        rows = a.table.rows
        ncols = max(len(r) for r in rows)
        x, y, w, h = visual_area
        shape = slide.shapes.add_table(len(rows), ncols, x, y, w, Emu(min(h, Inches(0.4) * len(rows))))
        for r_i, row in enumerate(rows):
            for c_i in range(ncols):
                cell = shape.table.cell(r_i, c_i)
                cell.text = strip_markup(row[c_i]) if c_i < len(row) else ""
                for p in cell.text_frame.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(14)
                        if r_i == 0 and a.table.header:
                            run.font.bold = True
    if a.chart:
        spec = a.chart
        if not spec.series:
            raise OpError("El gráfico no tiene series.")
        cd = CategoryChartData()
        cd.categories = spec.labels or [str(i + 1) for i in range(len(spec.series[0].values))]
        for s in spec.series:
            cd.add_series(s.name or "Serie", s.values)
        ct = {"column": XL_CHART_TYPE.COLUMN_CLUSTERED, "bar": XL_CHART_TYPE.BAR_CLUSTERED, "line": XL_CHART_TYPE.LINE_MARKERS,
              "pie": XL_CHART_TYPE.PIE, "area": XL_CHART_TYPE.AREA, "scatter": XL_CHART_TYPE.LINE_MARKERS}[spec.chart_type]
        x, y, w, h = visual_area
        gf = slide.shapes.add_chart(ct, x, y, w, h, cd)
        if spec.title:
            gf.chart.has_title = True
            gf.chart.chart_title.text_frame.text = spec.title
        gf.chart.has_legend = len(spec.series) > 1 or spec.chart_type == "pie"
    if a.notes:
        slide.notes_slide.notes_text_frame.text = a.notes
    n = len(prs.slides)
    ctx.check(f"La diapositiva {n} tiene el título «{a.title[:40]}»", lambda p, i=n - 1, t=a.title: i < len(p.slides) and (p.slides[i].shapes.title is None or p.slides[i].shapes.title.text == t))
    return f"Diapositiva {n} ({a.layout}) «{a.title[:60]}» añadida."


class PptxReplace(Args):
    find: str = Field(..., min_length=1)
    replace: str


@register("pptx.replace_text", "pptx", PptxReplace, "Reemplaza texto en todas las diapositivas (cuadros de texto y tablas) conservando el formato.")
def pptx_replace(ctx: ExecContext, a: PptxReplace) -> str:
    count = 0

    def frames(shapes):
        for sh in shapes:
            if sh.has_text_frame:
                yield sh.text_frame
            if getattr(sh, "has_table", False) and sh.has_table:
                for row in sh.table.rows:
                    for cell in row.cells:
                        yield cell.text_frame
            if sh.shape_type == 6:  # grupo
                yield from frames(sh.shapes)

    for slide in ctx.obj.slides:
        for tf in frames(slide.shapes):
            for p in tf.paragraphs:
                full = "".join(r.text for r in p.runs)
                if a.find not in full:
                    continue
                n = full.count(a.find)
                done = False
                for r in p.runs:
                    if a.find in r.text:
                        r.text = r.text.replace(a.find, a.replace)
                        done = True
                if not done and p.runs:  # el texto está repartido entre varios runs
                    p.runs[0].text = full.replace(a.find, a.replace)
                    for r in p.runs[1:]:
                        r.text = ""
                count += n
    if count == 0:
        raise OpError(f"No se encontró «{a.find}» en la presentación.")
    return f"Sustituido «{a.find}» ({count} vez/veces)."


class SlideNotes(Args):
    slide: int = Field(..., description="Índice Sn (desde 0)")
    text: str


@register("pptx.set_notes", "pptx", SlideNotes, "Escribe las notas del orador de una diapositiva existente.")
def pptx_notes(ctx: ExecContext, a: SlideNotes) -> str:
    slides = list(ctx.obj.slides)
    if not 0 <= a.slide < len(slides):
        raise OpError(f"La diapositiva S{a.slide} no existe.")
    slides[a.slide].notes_slide.notes_text_frame.text = a.text
    return f"Notas de S{a.slide} escritas."


class EditSlide(Args):
    slide: int
    title: Optional[str] = None
    bullets: Optional[list[str]] = None


@register("pptx.edit_slide", "pptx", EditSlide, "Cambia el título y/o el cuerpo de viñetas de una diapositiva existente.")
def pptx_edit(ctx: ExecContext, a: EditSlide) -> str:
    slides = list(ctx.obj.slides)
    if not 0 <= a.slide < len(slides):
        raise OpError(f"La diapositiva S{a.slide} no existe.")
    s = slides[a.slide]
    if a.title is not None:
        if s.shapes.title is None:
            raise OpError("La diapositiva no tiene marcador de título.")
        s.shapes.title.text = a.title
    if a.bullets is not None:
        body = [ph for ph in s.placeholders if ph.placeholder_format.idx != 0 and ph.has_text_frame]
        if not body:
            raise OpError("La diapositiva no tiene cuerpo de texto editable.")
        _fill_tf(body[0].text_frame, a.bullets)
    return f"Diapositiva S{a.slide} editada."


class DeleteSlide(Args):
    slide: int


@register("pptx.delete_slide", "pptx", DeleteSlide, "Elimina una diapositiva existente (solo si el enunciado lo pide).")
def pptx_delete(ctx: ExecContext, a: DeleteSlide) -> str:
    prs = ctx.obj
    ids = prs.slides._sldIdLst
    items = list(ids)
    if not 0 <= a.slide < len(items):
        raise OpError(f"La diapositiva S{a.slide} no existe.")
    rid = items[a.slide].get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    prs.part.drop_rel(rid)
    ids.remove(items[a.slide])
    return f"Diapositiva S{a.slide} eliminada."


# =========================================================================== #
# PDF
# =========================================================================== #
def open_pdf(ctx: ExecContext, base: Path | None) -> None:
    if base:
        import pymupdf as fitz

        ctx.obj = {"mode": "edit", "doc": fitz.open(str(base))}
    else:
        ctx.obj = {"mode": "new", "blocks": [], "title": "", "author": "", "header": "", "footer": "", "page_numbers": True, "convert": None}


def save_pdf(ctx: ExecContext) -> None:
    o = ctx.obj
    if o["mode"] == "edit":
        o["doc"].save(str(ctx.out_path), garbage=3, deflate=True)
        return
    if o.get("convert"):
        if o["blocks"]:
            raise OpError("Un PDF no puede ser a la vez conversión y documento nuevo.")
        shutil.copyfile(o["convert"], ctx.out_path)
        return
    if not o["blocks"]:
        raise OpError("El PDF no tiene contenido.")
    build_pdf(ctx, o)


def reopen_pdf(path: Path):
    import pymupdf as fitz

    return fitz.open(str(path))


def _rl_markup(text: str) -> str:
    from xml.sax.saxutils import escape

    out = []
    for chunk, fmt in markup_runs(text):
        s = escape(chunk).replace("\n", "<br/>")
        if fmt.get("bold"):
            s = f"<b>{s}</b>"
        if fmt.get("italic"):
            s = f"<i>{s}</i>"
        if fmt.get("underline"):
            s = f"<u>{s}</u>"
        out.append(s)
    return "".join(out)


def build_pdf(ctx: ExecContext, o: dict) -> None:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Image, ListFlowable, ListItem, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    al = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT, "justify": TA_JUSTIFY}
    story = []
    for i, b in enumerate(o["blocks"]):
        if b.type == "heading":
            st = styles[f"Heading{min(max(b.level or 1, 1), 4)}"]
            story.append(Paragraph(_rl_markup(b.text or ""), st))
        elif b.type == "paragraph":
            st = styles["BodyText"].clone(f"p{i}", alignment=al.get(b.align or "justify", TA_JUSTIFY), spaceAfter=6)
            story.append(Paragraph(_rl_markup(b.text or ""), st))
        elif b.type in ("bullets", "numbered"):
            items = [ListItem(Paragraph(_rl_markup(t), styles["BodyText"])) for t in (b.items or [])]
            story.append(ListFlowable(items, bulletType="bullet" if b.type == "bullets" else "1", start=None if b.type == "bullets" else 1))
        elif b.type == "table":
            rows = b.rows or []
            ncols = max(len(r) for r in rows)
            cell_style = styles["BodyText"].clone(f"c{i}", fontSize=9, leading=11)
            data = [[Paragraph(_rl_markup(r[c] if c < len(r) else ""), cell_style) for c in range(ncols)] for r in rows]
            t = Table(data, repeatRows=1 if b.header else 0, colWidths=[(A4[0] - 4 * cm) / ncols] * ncols)
            ts = [("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]
            if b.header:
                ts += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCE6F1"))]
            t.setStyle(TableStyle(ts))
            story.append(t)
            if b.caption:
                story.append(Paragraph(_rl_markup(b.caption), styles["Italic"]))
            story.append(Spacer(1, 8))
        elif b.type in ("image", "chart"):
            if b.type == "image":
                path = ctx.input_path(b.file_id or "", ("image",))
            else:
                if not b.chart:
                    raise OpError("Falta la especificación del gráfico.")
                path = render_chart_png(b.chart, ctx.work_dir / f"pdfchart_{ctx.out_path.stem}_{i}.png")
            from PIL import Image as PILImage

            with PILImage.open(path) as im:
                w, h = im.size
            width = min((b.width_cm or 15) * cm, A4[0] - 4 * cm)
            story.append(Image(str(path), width=width, height=width * h / w))
            if b.caption:
                story.append(Paragraph(_rl_markup(b.caption), styles["Italic"].clone(f"cap{i}", alignment=TA_CENTER)))
            story.append(Spacer(1, 8))
        elif b.type == "page_break":
            story.append(PageBreak())
        elif b.type == "toc":
            ctx.warnings.append("Los índices automáticos no están disponibles en PDF generado; se omitió.")

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        if o["header"]:
            canvas.drawString(2 * cm, A4[1] - 1.2 * cm, o["header"])
        foot = o["footer"]
        if o["page_numbers"]:
            foot = (foot + "   ·   " if foot else "") + f"Página {doc.page}"
        if foot:
            canvas.drawCentredString(A4[0] / 2, 1.2 * cm, foot)
        canvas.restoreState()

    doc = SimpleDocTemplate(str(ctx.out_path), pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=o["title"], author=o["author"])
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)


class PdfContent(Args):
    blocks: list[Block] = Field(..., min_length=1)


@register("pdf.add_content", "pdf", PdfContent, "Añade bloques (títulos, párrafos, listas, tablas, imágenes, gráficos, saltos) a un PDF nuevo generado con ReportLab.")
def pdf_add_content(ctx: ExecContext, a: PdfContent) -> str:
    if ctx.obj["mode"] != "new":
        raise OpError("Para PDF existentes usa pdf.fill_form o pdf.add_text.")
    ctx.obj["blocks"].extend(a.blocks)
    for b in a.blocks:
        if b.type in ("heading", "paragraph") and b.text:
            snippet = strip_markup(b.text).split("\n")[0][:40]
            ctx.check(f"El PDF contiene «{snippet}»", lambda d, s=snippet: s.replace(" ", "") in "".join(p.get_text() for p in d).replace(" ", "").replace("\n", ""))
    return f"{len(a.blocks)} bloque(s) añadidos al PDF."


class PdfOptions(Args):
    title: Optional[str] = None
    author: Optional[str] = None
    header: Optional[str] = None
    footer: Optional[str] = None
    page_numbers: Optional[bool] = None


@register("pdf.set_options", "pdf", PdfOptions, "Título y autor del PDF nuevo, encabezado, pie y numeración de páginas.")
def pdf_options(ctx: ExecContext, a: PdfOptions) -> str:
    if ctx.obj["mode"] != "new":
        raise OpError("Solo aplicable a PDF nuevos.")
    for k, v in a.model_dump().items():
        if v is not None:
            ctx.obj[k] = v
    return "Opciones del PDF establecidas."


class PdfConvert(Args):
    deliverable_id: str = Field(..., description="Id de un entregable DOCX/XLSX/PPTX generado ANTES en el plan")


@register("pdf.convert_from", "pdf", PdfConvert, "Convierte a PDF otro entregable ya generado (DOCX, XLSX o PPTX) usando LibreOffice. Úsalo cuando se pida entregar el documento en PDF.")
def pdf_convert(ctx: ExecContext, a: PdfConvert) -> str:
    from ..convert import convert_to_pdf

    src = ctx.produced.get(a.deliverable_id)
    if src is None:
        raise OpError(f"El entregable «{a.deliverable_id}» no se ha generado antes que este PDF.")
    out = convert_to_pdf(src, ctx.work_dir)
    ctx.obj["convert"] = out
    ctx.check("El PDF convertido tiene al menos una página", lambda d: d.page_count >= 1)
    return f"«{src.name}» convertido a PDF."


class FormFields(Args):
    fields: dict[str, str] = Field(..., description="nombre_del_campo → valor")


@register("pdf.fill_form", "pdf", FormFields, "Rellena los campos de formulario de un PDF subido (usar como base el PDF).")
def pdf_fill_form(ctx: ExecContext, a: FormFields) -> str:
    if ctx.obj["mode"] != "edit":
        raise OpError("pdf.fill_form requiere un PDF base.")
    doc = ctx.obj["doc"]
    filled = 0
    for page in doc:
        for w in page.widgets() or []:
            if w.field_name in a.fields:
                w.field_value = a.fields[w.field_name]
                w.update()
                filled += 1
    missing = set(a.fields) - {w.field_name for p in doc for w in (p.widgets() or [])}
    if missing:
        ctx.warnings.append("Campos inexistentes en el PDF: " + ", ".join(sorted(missing)))
    if not filled:
        raise OpError("No se rellenó ningún campo.")
    return f"{filled} campo(s) del formulario rellenados."


class PdfText(Args):
    page: int = Field(..., description="Página (desde 1)")
    x_cm: float
    y_cm: float = Field(..., description="Distancia desde el borde superior, en cm")
    text: str
    size: float = 11


@register("pdf.add_text", "pdf", PdfText, "Escribe texto en una posición de un PDF existente (p.ej. para responder en huecos de una ficha).")
def pdf_add_text(ctx: ExecContext, a: PdfText) -> str:
    if ctx.obj["mode"] != "edit":
        raise OpError("pdf.add_text requiere un PDF base.")
    doc = ctx.obj["doc"]
    if not 1 <= a.page <= doc.page_count:
        raise OpError(f"La página {a.page} no existe.")
    page = doc[a.page - 1]
    k = 72 / 2.54
    page.insert_text((a.x_cm * k, a.y_cm * k), a.text, fontsize=a.size, fontname="helv")
    snippet = a.text.split("\n")[0][:30]
    ctx.check(f"La página {a.page} contiene «{snippet}»", lambda d, p=a.page, s=snippet: s in d[p - 1].get_text())
    return f"Texto añadido en la página {a.page}."


# =========================================================================== #
# CSV
# =========================================================================== #
def open_csv(ctx: ExecContext, base: Path | None) -> None:
    from ..ingest.other import decode_text, sniff_csv

    if base:
        rows, delim = sniff_csv(decode_text(base.read_bytes()))
        ctx.obj = {"rows": rows, "delimiter": delim}
    else:
        ctx.obj = {"rows": [], "delimiter": ";"}


def save_csv(ctx: ExecContext) -> None:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=ctx.obj["delimiter"], lineterminator="\r\n")
    w.writerows(ctx.obj["rows"])
    ctx.out_path.write_text(buf.getvalue(), encoding="utf-8-sig")


def reopen_csv(path: Path):
    from ..ingest.other import decode_text, sniff_csv

    return sniff_csv(decode_text(path.read_bytes()))[0]


class CsvWrite(Args):
    header: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    delimiter: Literal[",", ";", "\t", "|"] = ";"
    append: bool = False


@register("csv.write", "csv", CsvWrite, "Escribe (o añade) filas en el CSV de salida. ';' es el separador que Excel en español abre directamente.")
def csv_write(ctx: ExecContext, a: CsvWrite) -> str:
    rows = ([a.header] if a.header else []) + [[str(v) for v in r] for r in a.rows]
    if not rows:
        raise OpError("No hay filas que escribir.")
    ctx.obj["rows"] = (ctx.obj["rows"] if a.append else []) + rows
    ctx.obj["delimiter"] = a.delimiter
    n = len(ctx.obj["rows"])
    ctx.check(f"El CSV tiene {n} filas", lambda rr, n=n: len(rr) == n)
    return f"CSV con {n} filas."


class CsvFilter(Args):
    column: str
    op: Literal["==", "!=", ">", "<", ">=", "<=", "contains"]
    value: str


class CsvTransform(Args):
    file_id: str = Field(..., description="CSV subido (o XLSX subido si se indica sheet)")
    sheet: Optional[str] = Field(None, description="Hoja si el origen es un XLSX")
    columns: list[str] = Field(default_factory=list, description="Columnas a conservar (por nombre de cabecera); vacío = todas")
    filters: list[CsvFilter] = Field(default_factory=list)
    sort_by: Optional[str] = None
    descending: bool = False
    delimiter: Literal[",", ";", "\t", "|"] = ";"


@register("csv.transform", "csv", CsvTransform, "Genera el CSV a partir de un CSV o una hoja XLSX subidos: seleccionar columnas, filtrar filas y ordenar.")
def csv_transform(ctx: ExecContext, a: CsvTransform) -> str:
    from ..ingest.other import decode_text, sniff_csv
    from .xlsx_tools import parse_number

    meta = ctx.inputs.get(a.file_id)
    if meta is None:
        raise OpError(f"Archivo «{a.file_id}» inexistente.")
    if meta["kind"] == "xlsx":
        import openpyxl

        wb = openpyxl.load_workbook(meta["path"], data_only=True)
        if not a.sheet or a.sheet not in wb.sheetnames:
            raise OpError(f"Indica una hoja válida: {', '.join(wb.sheetnames)}")
        rows = [["" if v is None else str(v) for v in r] for r in wb[a.sheet].iter_rows(values_only=True)]
    elif meta["kind"] in ("csv", "txt"):
        rows = sniff_csv(decode_text(Path(meta["path"]).read_bytes()))[0]
    else:
        raise OpError("El origen debe ser CSV o XLSX.")
    if not rows:
        raise OpError("El origen está vacío.")
    header, data = rows[0], rows[1:]
    idx = {h.strip(): i for i, h in enumerate(header)}

    def col(name):
        if name.strip() not in idx:
            raise OpError(f"La columna «{name}» no existe. Columnas: {', '.join(header)}")
        return idx[name.strip()]

    def cmp(cell, f: CsvFilter):
        a_, b_ = parse_number(cell), parse_number(f.value)
        if f.op == "contains":
            return f.value.lower() in cell.lower()
        if isinstance(a_, str) or isinstance(b_, str):
            a_, b_ = str(a_).lower(), str(b_).lower()
        return {"==": a_ == b_, "!=": a_ != b_, ">": a_ > b_, "<": a_ < b_, ">=": a_ >= b_, "<=": a_ <= b_}[f.op]

    for f in a.filters:
        ci = col(f.column)
        data = [r for r in data if ci < len(r) and cmp(r[ci], f)]
    if a.sort_by:
        ci = col(a.sort_by)
        data.sort(key=lambda r: (0, parse_number(r[ci]), "") if not isinstance(parse_number(r[ci]), str) else (1, 0, r[ci].lower()), reverse=a.descending)
    if a.columns:
        cis = [col(c) for c in a.columns]
        header = [header[i] for i in cis]
        data = [[r[i] if i < len(r) else "" for i in cis] for r in data]
    ctx.obj["rows"] = [header] + data
    ctx.obj["delimiter"] = a.delimiter
    n = len(data) + 1
    ctx.check(f"El CSV tiene {n} filas (incluida cabecera)", lambda rr, n=n: len(rr) == n)
    return f"CSV generado: {len(data)} filas, {len(header)} columnas."
