"""Prepara una carpeta lista para subir a un Space de Hugging Face.

Uso:  python scripts/preparar_space.py [carpeta_destino] [--gradio]   (por defecto: hf-space, tipo Docker)
Con --gradio genera la variante para un Space de tipo «Gradio» (sin Dockerfile:
LibreOffice se instala con packages.txt y el servidor se arranca desde main.py).
Luego arrastra TODO el contenido de esa carpeta a «Files › Add file › Upload files» del Space.
"""
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "backend"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
gradio = "--gradio" in sys.argv
out = Path(args[0] if args else root / "hf-space")
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
shutil.copy(src / "requirements.txt", out / "requirements.txt")
if gradio:
    shutil.copy(src / "hf_main.py", out / "main.py")
    (out / "packages.txt").write_text(
        "libreoffice-writer\nlibreoffice-calc\nlibreoffice-impress\nfonts-dejavu\nfonts-liberation\nfonts-crosextra-carlito\n",
        encoding="utf-8")
    header = "sdk: gradio\nsdk_version: 6.32.0\napp_file: main.py\npython_version: \"3.12\""
else:
    shutil.copy(src / "Dockerfile", out / "Dockerfile")
    header = "sdk: docker\napp_port: 7860"
shutil.copytree(src / "app", out / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
(out / "README.md").write_text(f"""---
title: ClassForge AI API
emoji: 🛠️
colorFrom: indigo
colorTo: purple
{header}
pinned: false
---

Backend de ClassForge AI. La interfaz está en Netlify.
""", encoding="utf-8")
print(f"Carpeta lista: {out.resolve()}")
for p in sorted(out.rglob("*")):
    if p.is_file() and p.parent == out or p.name == "app":
        print("  ", p.relative_to(out))
