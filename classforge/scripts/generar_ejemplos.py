"""Genera documentos de ejemplo de Digitalización para probar ClassForge a mano.

Uso:  python scripts/generar_ejemplos.py [carpeta_destino]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from tests import fixtures as fx  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "ejemplos")
out.mkdir(parents=True, exist_ok=True)
fx.make_word_template(out / "Practica2_Word.docx")
fx.make_excel_template(out / "Practica3_Excel.xlsx")
fx.make_pdf_statement(out / "Tarea4_Enunciado.pdf")
fx.make_csv(out / "notas.csv")
fx.make_png(out / "ejercicio5.png")
print(f"Ejemplos creados en {out.resolve()}")
