"""Catálogo de herramientas documentales. Importar los módulos registra las operaciones."""
from . import docx_tools, other_tools, xlsx_tools  # noqa: F401  (registro por efecto lateral)
from .base import REGISTRY, catalog_text  # noqa: F401

# formato -> (abrir, guardar, reabrir para validar)
FORMATS = {
    "docx": (docx_tools.open_doc, docx_tools.save_doc, docx_tools.reopen),
    "xlsx": (xlsx_tools.open_wb, xlsx_tools.save_wb, xlsx_tools.reopen),
    "pptx": (other_tools.open_prs, other_tools.save_prs, other_tools.reopen_prs),
    "pdf": (other_tools.open_pdf, other_tools.save_pdf, other_tools.reopen_pdf),
    "csv": (other_tools.open_csv, other_tools.save_csv, other_tools.reopen_csv),
}
