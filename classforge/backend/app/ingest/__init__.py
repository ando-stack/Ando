"""Etapa 1: INGESTA. Lee cada archivo subido y extrae texto, tablas, estructura
e imágenes (estas últimas se envían al modelo con visión)."""
from __future__ import annotations

from pathlib import Path

from ..config import settings
from ..security import scan_for_injection
from .office import ingest_docx, ingest_pptx, ingest_xlsx
from .other import ingest_csv, ingest_image, ingest_pdf, ingest_text, normalize_image

INGESTORS = {
    "docx": ingest_docx,
    "xlsx": ingest_xlsx,
    "pptx": ingest_pptx,
    "pdf": ingest_pdf,
    "csv": ingest_csv,
    "txt": ingest_text,
    "image": ingest_image,
}


def ingest_file(path: Path, file_meta: dict, work_dir: Path) -> dict:
    """Devuelve el registro de ingesta de un archivo. Nunca lanza: los errores se reportan."""
    kind = file_meta["kind"]
    record = {"file_id": file_meta["id"], "name": file_meta["name"], "kind": kind, "ok": True, "error": None,
              "text": "", "structure": {}, "images": [], "truncated": False, "flags": []}
    try:
        result = INGESTORS[kind](path)
    except Exception as e:  # noqa: BLE001
        record.update(ok=False, error=f"No se pudo leer «{file_meta['name']}»: {type(e).__name__}: {e}")
        return record

    text = result["text"]
    if len(text) > settings.max_chars_per_doc:
        text = text[: settings.max_chars_per_doc] + "\n[… contenido truncado: el documento es muy largo …]"
        record["truncated"] = True
    record["text"] = text
    record["structure"] = result.get("structure", {})

    work_dir.mkdir(parents=True, exist_ok=True)
    for i, (name, data) in enumerate(result.get("embedded_images", [])[: settings.max_image_pages]):
        try:
            png = normalize_image(data)
        except Exception:  # noqa: BLE001 - imagen no legible (p.ej. EMF)
            continue
        p = work_dir / f"{file_meta['id']}_img{i}.png"
        p.write_bytes(png)
        record["images"].append({"path": p.name, "label": f"{file_meta['name']} · {name}"})

    record["flags"] = scan_for_injection(text, file_meta["name"])
    return record
