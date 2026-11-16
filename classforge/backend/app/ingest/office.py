"""Etapa 1 (ingesta) para DOCX, XLSX y PPTX."""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

PLACEHOLDER_RE = re.compile(r"(_{3,}|\.{4,}|…{2,}|\[[^\]\n]{1,60}\]|<<[^>\n]{1,60}>>|\{\{[^}\n]{1,60}\}\}|\(completar\)|XXX+)", re.IGNORECASE)


def _clip(s: str, n: int = 400) -> str:
    s = s.replace("\n", " ⏎ ")
    return s if len(s) <= n else s[:n] + "…"


# --------------------------------------------------------------------------- #
# DOCX
# --------------------------------------------------------------------------- #
def ingest_docx(path: Path) -> dict:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = docx.Document(str(path))
    lines: list[str] = []
    placeholders: list[dict] = []
    p_idx = 0
    t_idx = 0
    para_index = {p._p: i for i, p in enumerate(doc.paragraphs)}
    table_index = {t._tbl: i for i, t in enumerate(doc.tables)}

    for block in doc.iter_inner_content():
        if isinstance(block, Paragraph):
            p_idx = para_index.get(block._p, p_idx)
            text = block.text
            style = block.style.name if block.style is not None else ""
            has_img = bool(block._p.xpath(".//pic:pic"))
            if not text.strip() and not has_img:
                lines.append(f"[P{p_idx}] (vacío)")
                continue
            extra = " [contiene imagen]" if has_img else ""
            lines.append(f"[P{p_idx}] ({style}) {_clip(text, 1500)}{extra}")
            for m in PLACEHOLDER_RE.finditer(text):
                placeholders.append({"where": f"P{p_idx}", "text": m.group(0), "context": _clip(text, 160)})
        elif isinstance(block, Table):
            t_idx = table_index.get(block._tbl, t_idx)
            rows = len(block.rows)
            cols = len(block.columns)
            lines.append(f"[T{t_idx}] Tabla {rows} filas × {cols} columnas (estilo: {block.style.name if block.style else '-'})")
            for r, row in enumerate(block.rows[:60]):
                cells = []
                seen = set()
                for c, cell in enumerate(row.cells):
                    key = cell._tc
                    txt = "<combinada>" if key in seen else _clip(cell.text.strip(), 200) or "∅"
                    seen.add(key)
                    cells.append(f"C{c}={txt}")
                    for m in PLACEHOLDER_RE.finditer(cell.text):
                        placeholders.append({"where": f"T{t_idx} R{r} C{c}", "text": m.group(0), "context": _clip(cell.text, 120)})
                lines.append(f"  [T{t_idx} R{r}] " + " | ".join(cells))
            if rows > 60:
                lines.append(f"  … ({rows - 60} filas más)")

    headers, footers = [], []
    for s_i, section in enumerate(doc.sections):
        h = " / ".join(p.text for p in section.header.paragraphs if p.text.strip())
        f = " / ".join(p.text for p in section.footer.paragraphs if p.text.strip())
        if h:
            headers.append(f"Sección {s_i}: {h}")
        if f:
            footers.append(f"Sección {s_i}: {f}")
    sec = doc.sections[0]
    page = f"Página: {'horizontal' if sec.page_width > sec.page_height else 'vertical'}, márgenes {round(sec.left_margin.cm, 1) if sec.left_margin else '?'} cm"

    head = [f"Párrafos: {len(doc.paragraphs)} · Tablas: {len(doc.tables)} · {page}"]
    if headers:
        head.append("Encabezado: " + " | ".join(headers))
    if footers:
        head.append("Pie de página: " + " | ".join(footers))
    if placeholders:
        head.append("Huecos/plantilla detectados: " + "; ".join(f"{p['where']}: {p['text']!r}" for p in placeholders[:40]))

    images = _zip_media(path, "word/media/")
    styles = sorted({p.style.name for p in doc.paragraphs if p.style is not None})
    return {
        "text": "\n".join(head + lines),
        "structure": {
            "paragraphs": len(doc.paragraphs),
            "tables": len(doc.tables),
            "table_shapes": [[len(t.rows), len(t.columns)] for t in doc.tables],
            "headers": headers,
            "footers": footers,
            "styles": styles,
            "images": len(images),
            "placeholders": placeholders,
        },
        "embedded_images": images,
    }


def _zip_media(path: Path, prefix: str, limit: int = 6) -> list[tuple[str, bytes]]:
    out = []
    try:
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                n = info.filename.lower()
                if n.startswith(prefix) and n.endswith((".png", ".jpg", ".jpeg")) and info.file_size < 8 * 1024 * 1024:
                    out.append((info.filename, zf.read(info)))
                    if len(out) >= limit:
                        break
    except zipfile.BadZipFile:
        pass
    return out


# --------------------------------------------------------------------------- #
# XLSX
# --------------------------------------------------------------------------- #
def ingest_xlsx(path: Path, max_cells: int = 4000) -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(str(path), data_only=False)
    try:
        wb_vals = openpyxl.load_workbook(str(path), data_only=True)
    except Exception:  # noqa: BLE001
        wb_vals = None
    lines: list[str] = []
    sheets_info = []
    cells_left = max_cells
    for ws in wb.worksheets:
        charts = len(getattr(ws, "_charts", []))
        images = len(getattr(ws, "_images", []))
        merged = [str(r) for r in ws.merged_cells.ranges]
        dv = len(ws.data_validations.dataValidation) if ws.data_validations else 0
        cf = len(list(ws.conditional_formatting))
        tables = list(ws.tables.keys())
        lines.append(f"=== Hoja «{ws.title}» · rango usado {ws.dimensions} · {ws.max_row} filas × {ws.max_column} columnas")
        extras = []
        if merged:
            extras.append("celdas combinadas: " + ", ".join(merged[:30]))
        if charts:
            extras.append(f"gráficos: {charts}")
        if images:
            extras.append(f"imágenes: {images}")
        if dv:
            extras.append(f"validaciones de datos: {dv}")
        if cf:
            extras.append(f"formatos condicionales: {cf}")
        if tables:
            extras.append("tablas: " + ", ".join(tables))
        if ws.freeze_panes:
            extras.append(f"paneles inmovilizados en {ws.freeze_panes}")
        if extras:
            lines.append("  " + " · ".join(extras))
        vws = wb_vals[ws.title] if wb_vals is not None else None
        n_formulas = 0
        for row in ws.iter_rows():
            parts = []
            for c in row:
                if c.value is None:
                    continue
                v = c.value
                if isinstance(v, str) and v.startswith("="):
                    n_formulas += 1
                    cached = vws[c.coordinate].value if vws is not None else None
                    txt = f"{v}" + (f" (→ {cached})" if cached is not None else "")
                else:
                    txt = repr(v) if not isinstance(v, str) else "\"" + _clip(v, 200) + "\""
                fmt = []
                if c.font is not None and c.font.b:
                    fmt.append("negrita")
                if c.number_format and c.number_format != "General":
                    fmt.append(f"formato {c.number_format}")
                if c.fill is not None and c.fill.fgColor is not None and c.fill.fill_type == "solid":
                    fmt.append(f"relleno {c.fill.fgColor.rgb}")
                parts.append(f"{c.coordinate}={txt}" + (f" {{{', '.join(fmt)}}}" if fmt else ""))
            if parts:
                if cells_left <= 0:
                    lines.append("  … (contenido truncado por longitud)")
                    break
                cells_left -= len(parts)
                lines.append("  " + " | ".join(parts))
        sheets_info.append({
            "name": ws.title, "dimensions": ws.dimensions, "max_row": ws.max_row, "max_col": ws.max_column,
            "charts": charts, "images": images, "merged": merged, "data_validations": dv,
            "conditional_formats": cf, "tables": tables, "formulas": n_formulas,
        })
    names = list(wb.defined_names.keys()) if hasattr(wb.defined_names, "keys") else []
    head = [f"Hojas: {', '.join(ws.title for ws in wb.worksheets)}"]
    if names:
        head.append("Nombres definidos: " + ", ".join(names))
    return {"text": "\n".join(head + lines), "structure": {"sheets": sheets_info, "defined_names": names}, "embedded_images": _zip_media(path, "xl/media/")}


# --------------------------------------------------------------------------- #
# PPTX
# --------------------------------------------------------------------------- #
def ingest_pptx(path: Path) -> dict:
    from pptx import Presentation

    prs = Presentation(str(path))
    lines = [f"Diapositivas: {len(prs.slides)} · Diseños disponibles: " + ", ".join(f"{i}:{l.name}" for i, l in enumerate(prs.slide_layouts))]
    slides = []
    for i, slide in enumerate(prs.slides):
        title = slide.shapes.title.text if slide.shapes.title is not None and slide.shapes.title.has_text_frame else ""
        lines.append(f"[S{i}] diseño «{slide.slide_layout.name}» · título: {title!r}")
        n_img = 0
        for sh in slide.shapes:
            if sh.has_text_frame and sh != slide.shapes.title and sh.text_frame.text.strip():
                lines.append(f"  [S{i} {sh.name}] {_clip(sh.text_frame.text, 800)}")
            if getattr(sh, "has_table", False) and sh.has_table:
                for r, row in enumerate(sh.table.rows):
                    lines.append(f"  [S{i} tabla R{r}] " + " | ".join(_clip(c.text, 80) for c in row.cells))
            if sh.shape_type == 13:
                n_img += 1
            if getattr(sh, "has_chart", False) and sh.has_chart:
                lines.append(f"  [S{i}] gráfico: {sh.chart.chart_type}")
        if n_img:
            lines.append(f"  [S{i}] imágenes: {n_img}")
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            lines.append(f"  [S{i} notas] {_clip(slide.notes_slide.notes_text_frame.text, 600)}")
        slides.append({"title": title, "layout": slide.slide_layout.name, "images": n_img})
    return {"text": "\n".join(lines), "structure": {"slides": slides, "layouts": [l.name for l in prs.slide_layouts]}, "embedded_images": _zip_media(path, "ppt/media/")}
