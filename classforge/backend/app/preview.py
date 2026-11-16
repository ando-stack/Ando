"""Vistas previas HTML de los archivos generados (o subidos).

El HTML se construye escapando todo el texto, sin scripts; el frontend además lo
muestra en un iframe con sandbox."""
from __future__ import annotations

import base64
import html
from pathlib import Path

CSS = """
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#1d1d1f;font-size:14px}
.page{background:#fff;max-width:820px;margin:0 auto 18px;padding:48px 56px;box-shadow:0 1px 4px rgba(0,0,0,.12);border-radius:4px;line-height:1.5}
h1{font-size:24px}h2{font-size:20px}h3{font-size:17px}h4{font-size:15px}
table{border-collapse:collapse;margin:10px 0;font-size:13px}td,th{border:1px solid #c8ccd2;padding:4px 8px;vertical-align:top}
.sheet{background:#fff;margin:0 auto 18px;box-shadow:0 1px 4px rgba(0,0,0,.12);border-radius:4px;overflow:auto;max-width:100%}
.sheet h3{margin:0;padding:10px 14px;background:#eef1f5;border-bottom:1px solid #d6dbe1;font-size:14px}
.sheet table{margin:0}.sheet td{white-space:nowrap;min-width:60px;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.rh{background:#eef1f5;color:#666;text-align:center;font-size:11px}.f{color:#0b6b3a}.err{background:#fde2e2;color:#a40000}
.meta{color:#666;font-size:12px;padding:6px 14px}.slide{background:#fff;max-width:820px;aspect-ratio:16/9;margin:0 auto 18px;padding:28px 36px;box-shadow:0 1px 4px rgba(0,0,0,.12);border-radius:6px;overflow:hidden;position:relative}
.slide .n{position:absolute;right:12px;bottom:8px;color:#999;font-size:11px}.notes{max-width:820px;margin:-10px auto 18px;color:#555;font-size:12px;background:#fffbe6;padding:8px 12px;border-radius:4px}
img{max-width:100%}.hf{color:#777;font-size:11px;border-bottom:1px dashed #ddd;margin-bottom:12px;padding-bottom:4px}.ft{border-top:1px dashed #ddd;border-bottom:0;margin-top:16px;padding-top:4px}
.tag{display:inline-block;background:#eef1f5;border-radius:4px;padding:1px 6px;font-size:11px;color:#555;margin-left:6px}
"""

E = html.escape


def wrap(body: str) -> str:
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}</body></html>"


def _img_tag(data: bytes, ct: str = "image/png") -> str:
    return f"<img src='data:{ct};base64,{base64.b64encode(data).decode()}'/>"


def preview_docx(path: Path) -> str:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = docx.Document(str(path))
    rels = doc.part.rels
    parts = []
    head = " / ".join(p.text for p in doc.sections[0].header.paragraphs if p.text.strip())
    if head:
        parts.append(f"<div class='hf'>{E(head)}</div>")

    def runs_html(p: Paragraph) -> str:
        out = []
        for r in p.runs:
            t = E(r.text).replace("\n", "<br/>")
            if r.bold:
                t = f"<b>{t}</b>"
            if r.italic:
                t = f"<i>{t}</i>"
            if r.underline:
                t = f"<u>{t}</u>"
            for blip in r._r.xpath(".//a:blip"):
                rid = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
                if rid in rels and hasattr(rels[rid].target_part, "blob"):
                    ct = rels[rid].target_part.content_type
                    if ct in ("image/png", "image/jpeg", "image/gif"):
                        t += _img_tag(rels[rid].target_part.blob, ct)
            out.append(t)
        return "".join(out) or "&nbsp;"

    def table_html(t: Table) -> str:
        rows = []
        for row in t.rows:
            seen = set()
            cells = []
            for c in row.cells:
                if c._tc in seen:
                    continue
                seen.add(c._tc)
                cells.append("<td>" + "<br/>".join(runs_html(p) for p in c.paragraphs) + "</td>")
            rows.append("<tr>" + "".join(cells) + "</tr>")
        return "<table>" + "".join(rows) + "</table>"

    for block in doc.iter_inner_content():
        if isinstance(block, Paragraph):
            style = (block.style.name if block.style is not None else "").lower()
            align = {0: "left", 1: "center", 2: "right", 3: "justify"}.get(block.alignment if block.alignment is not None else -1, "")
            st = f" style='text-align:{align}'" if align else ""
            if style.startswith("heading") or style.startswith("título") or style == "title":
                lvl = 1
                for ch in style:
                    if ch.isdigit():
                        lvl = min(int(ch), 4)
                        break
                parts.append(f"<h{lvl}{st}>{runs_html(block)}</h{lvl}>")
            elif "list" in style:
                parts.append(f"<p{st}>• {runs_html(block)}</p>")
            else:
                parts.append(f"<p{st}>{runs_html(block)}</p>")
        elif isinstance(block, Table):
            parts.append(table_html(block))
    foot = " / ".join(p.text for p in doc.sections[0].footer.paragraphs if p.text.strip())
    if foot:
        parts.append(f"<div class='hf ft'>{E(foot)}</div>")
    return wrap("<div class='page'>" + "".join(parts) + "</div>")


def preview_xlsx(path: Path, recalculated: Path | None = None, max_rows: int = 200, max_cols: int = 30) -> str:
    import openpyxl
    from openpyxl.utils import get_column_letter

    wb = openpyxl.load_workbook(str(path))
    vals = openpyxl.load_workbook(str(recalculated), data_only=True) if recalculated and recalculated.exists() else None
    out = []
    for ws in wb.worksheets:
        vws = vals[ws.title] if vals is not None and ws.title in vals.sheetnames else None
        mr, mc = min(ws.max_row, max_rows), min(ws.max_column, max_cols)
        rows = ["<tr><td class='rh'></td>" + "".join(f"<td class='rh'>{get_column_letter(c)}</td>" for c in range(1, mc + 1)) + "</tr>"]
        spans, covered = {}, set()
        for m in ws.merged_cells.ranges:
            spans[(m.min_row, m.min_col)] = (m.max_row - m.min_row + 1, min(m.max_col, mc) - m.min_col + 1)
            for rr in range(m.min_row, m.max_row + 1):
                for cc in range(m.min_col, m.max_col + 1):
                    if (rr, cc) != (m.min_row, m.min_col):
                        covered.add((rr, cc))
        for r in range(1, mr + 1):
            cells = [f"<td class='rh'>{r}</td>"]
            for c in range(1, mc + 1):
                if (r, c) in covered:
                    continue
                cell = ws.cell(r, c)
                v = cell.value
                styles = []
                if cell.font is not None and cell.font.b:
                    styles.append("font-weight:600")
                if cell.fill is not None and cell.fill.fill_type == "solid" and isinstance(cell.fill.fgColor.rgb, str) and len(cell.fill.fgColor.rgb) >= 6:
                    styles.append(f"background:#{cell.fill.fgColor.rgb[-6:]}")
                if cell.font is not None and cell.font.color is not None and isinstance(cell.font.color.rgb, str) and len(cell.font.color.rgb) >= 6:
                    styles.append(f"color:#{cell.font.color.rgb[-6:]}")
                cls, title = "", ""
                if isinstance(v, str) and v.startswith("="):
                    title = f" title='{E(v)}'"
                    computed = vws.cell(r, c).value if vws is not None else None
                    if computed is None:
                        txt = E(v)
                        cls = " class='f'"
                    else:
                        txt = E(_fmt(computed, cell.number_format))
                        if isinstance(computed, str) and computed.startswith("#"):
                            cls = " class='err'"
                else:
                    txt = "" if v is None else E(_fmt(v, cell.number_format))
                st = f" style='{';'.join(styles)}'" if styles else ""
                span = ""
                if (r, c) in spans:
                    rs, cs = spans[(r, c)]
                    span = (f" rowspan='{rs}'" if rs > 1 else "") + (f" colspan='{cs}'" if cs > 1 else "")
                cells.append(f"<td{cls}{st}{title}{span}>{txt}</td>")
            rows.append("<tr>" + "".join(cells) + "</tr>")
        extra = []
        if ws._charts:
            extra.append(f"{len(ws._charts)} gráfico(s)")
        if ws.merged_cells.ranges:
            extra.append(f"{len(ws.merged_cells.ranges)} rango(s) combinados")
        if ws.conditional_formatting:
            extra.append("formato condicional")
        if ws.max_row > max_rows or ws.max_column > max_cols:
            extra.append("vista recortada")
        meta = f"<div class='meta'>{E(' · '.join(extra))}</div>" if extra else ""
        out.append(f"<div class='sheet'><h3>{E(ws.title)}</h3>{meta}<table>{''.join(rows)}</table></div>")
    note = "" if vals is not None else "<p class='meta'>Las fórmulas se muestran sin calcular (Excel las calculará al abrir).</p>"
    return wrap(note + "".join(out))


def _fmt(v, nf: str | None) -> str:
    if isinstance(v, float):
        if nf and "%" in nf:
            return f"{v * 100:.2f}%".replace(".", ",")
        if nf and "€" in nf:
            return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
        s = f"{v:.4f}".rstrip("0").rstrip(".")
        return s.replace(".", ",")
    if hasattr(v, "strftime"):
        return v.strftime("%d/%m/%Y")
    return str(v)


def preview_pdf(path: Path, max_pages: int = 15) -> str:
    import pymupdf as fitz

    doc = fitz.open(str(path))
    imgs = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            imgs.append(f"<p class='meta'>… {doc.page_count - max_pages} página(s) más</p>")
            break
        pix = page.get_pixmap(dpi=90)
        imgs.append(f"<div class='page' style='padding:0'>{_img_tag(pix.tobytes('png'))}</div>")
    return wrap("".join(imgs))


def preview_pptx(path: Path) -> str:
    from pptx import Presentation

    prs = Presentation(str(path))
    out = []
    for i, slide in enumerate(prs.slides):
        parts = []
        title = slide.shapes.title.text if slide.shapes.title is not None else ""
        if title:
            parts.append(f"<h2>{E(title)}</h2>")
        for sh in slide.shapes:
            if sh == slide.shapes.title:
                continue
            if sh.has_text_frame and sh.text_frame.text.strip():
                items = "".join(f"<li style='margin-left:{p.level * 18}px'>{E(''.join(r.text for r in p.runs))}</li>" for p in sh.text_frame.paragraphs if p.runs)
                parts.append(f"<ul>{items}</ul>")
            elif getattr(sh, "has_table", False) and sh.has_table:
                rows = "".join("<tr>" + "".join(f"<td>{E(c.text)}</td>" for c in r.cells) + "</tr>" for r in sh.table.rows)
                parts.append(f"<table>{rows}</table>")
            elif getattr(sh, "has_chart", False) and sh.has_chart:
                parts.append(f"<p class='meta'>[Gráfico: {E(str(sh.chart.chart_type))}]</p>")
            elif sh.shape_type == 13:
                try:
                    parts.append(_img_tag(sh.image.blob, sh.image.content_type).replace("<img", "<img style='max-height:220px'"))
                except Exception:  # noqa: BLE001
                    parts.append("<p class='meta'>[Imagen]</p>")
        out.append(f"<div class='slide'>{''.join(parts)}<span class='n'>{i + 1}</span></div>")
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            out.append(f"<div class='notes'><b>Notas:</b> {E(slide.notes_slide.notes_text_frame.text)}</div>")
    return wrap("".join(out))


def preview_csv(path: Path) -> str:
    from .ingest.other import decode_text, sniff_csv

    rows, delim = sniff_csv(decode_text(path.read_bytes()))
    body = "".join("<tr>" + "".join(f"<td>{E(c)}</td>" for c in r) + "</tr>" for r in rows[:300])
    return wrap(f"<div class='sheet'><h3>CSV · separador {E(repr(delim))} · {len(rows)} filas</h3><table>{body}</table></div>")


def preview_image(path: Path) -> str:
    ct = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return wrap(f"<div class='page'>{_img_tag(path.read_bytes(), ct)}</div>")


def preview_text(path: Path) -> str:
    from .ingest.other import decode_text

    return wrap(f"<div class='page'><pre style='white-space:pre-wrap'>{E(decode_text(path.read_bytes()))}</pre></div>")


def render_preview(path: Path, kind: str, recalculated: Path | None = None) -> str:
    try:
        fn = {"docx": preview_docx, "pdf": preview_pdf, "pptx": preview_pptx, "csv": preview_csv, "image": preview_image, "txt": preview_text}.get(kind)
        if kind == "xlsx":
            return preview_xlsx(path, recalculated)
        if fn is None:
            return wrap("<p>Vista previa no disponible para este formato.</p>")
        return fn(path)
    except Exception as e:  # noqa: BLE001
        return wrap(f"<div class='page'><p>No se pudo generar la vista previa: {E(type(e).__name__)}: {E(str(e))}</p></div>")
