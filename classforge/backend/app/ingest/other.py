"""Etapa 1 (ingesta) para PDF, CSV, imágenes y texto plano."""
from __future__ import annotations

import csv
import io
from pathlib import Path

from ..config import settings


def decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def ingest_pdf(path: Path) -> dict:
    import pymupdf as fitz

    doc = fitz.open(str(path))
    lines = [f"Páginas: {doc.page_count}"]
    rendered: list[tuple[str, bytes]] = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        lines.append(f"--- Página {i + 1} ---")
        lines.append(text if text else "(sin texto extraíble: página escaneada o imagen)")
        try:
            tabs = page.find_tables()
            for t_i, tab in enumerate(tabs.tables[:5]):
                rows = tab.extract()
                lines.append(f"[Tabla {t_i} en página {i + 1}: {len(rows)} filas]")
                for r in rows[:40]:
                    lines.append("  " + " | ".join((c or "").replace("\n", " ") for c in r))
        except Exception:  # noqa: BLE001 - la detección de tablas es opcional
            pass
        needs_vision = len(text) < 80 or bool(page.get_images())
        if needs_vision and len(rendered) < settings.max_image_pages:
            pix = page.get_pixmap(dpi=110)
            rendered.append((f"pagina_{i + 1}.png", pix.tobytes("png")))
    return {"text": "\n".join(lines), "structure": {"pages": doc.page_count}, "embedded_images": rendered}


def sniff_csv(text: str) -> tuple[list[list[str]], str]:
    sample = text[:20000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delim = dialect.delimiter
    except csv.Error:
        delim = ";" if sample.count(";") > sample.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    return rows, delim


def ingest_csv(path: Path) -> dict:
    text = decode_text(path.read_bytes())
    rows, delim = sniff_csv(text)
    lines = [f"CSV con separador {delim!r}: {len(rows)} filas × {max((len(r) for r in rows), default=0)} columnas"]
    for i, r in enumerate(rows[:200]):
        lines.append(f"  F{i + 1}: " + " | ".join(r))
    if len(rows) > 200:
        lines.append(f"  … ({len(rows) - 200} filas más)")
    return {"text": "\n".join(lines), "structure": {"rows": len(rows), "delimiter": delim, "header": rows[0] if rows else []}, "embedded_images": []}


def ingest_text(path: Path) -> dict:
    text = decode_text(path.read_bytes())
    return {"text": text, "structure": {"chars": len(text)}, "embedded_images": []}


def normalize_image(data: bytes, max_side: int = 1568) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side))
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


def ingest_image(path: Path) -> dict:
    from PIL import Image

    data = path.read_bytes()
    with Image.open(io.BytesIO(data)) as im:
        size = im.size
    return {
        "text": f"Imagen {size[0]}×{size[1]} px. Su contenido se analiza con visión (ver imagen adjunta).",
        "structure": {"width": size[0], "height": size[1]},
        "embedded_images": [(path.name, data)],
    }
