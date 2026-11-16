"""Prepara una carpeta lista para subir a un Space de Hugging Face (Docker).

Uso:  python scripts/preparar_space.py [carpeta_destino]   (por defecto: hf-space)
Luego arrastra TODO el contenido de esa carpeta a «Files › Add file › Upload files» del Space.
"""
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "backend"
out = Path(sys.argv[1] if len(sys.argv) > 1 else root / "hf-space")
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
shutil.copy(src / "Dockerfile", out / "Dockerfile")
shutil.copy(src / "requirements.txt", out / "requirements.txt")
shutil.copytree(src / "app", out / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
(out / "README.md").write_text("""---
title: ClassForge AI API
emoji: 🛠️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

Backend de ClassForge AI. La interfaz está en Netlify.
""", encoding="utf-8")
print(f"Carpeta lista: {out.resolve()}")
for p in sorted(out.rglob("*")):
    if p.is_file() and p.parent == out or p.name == "app":
        print("  ", p.relative_to(out))
