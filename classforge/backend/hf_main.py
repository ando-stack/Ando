"""Arranque del servidor en un Space de Hugging Face de tipo «Gradio».

Hugging Face ejecuta ``python main.py`` y expone el puerto 7860. No usamos la
interfaz de Gradio: arrancamos directamente la API FastAPI de ClassForge."""
import os
import zipfile
from pathlib import Path

# La web de Hugging Face no permite subir carpetas: el código va en app.zip
# y se descomprime aquí la primera vez.
_here = Path(__file__).resolve().parent
if not (_here / "app" / "main.py").exists() and (_here / "app.zip").exists():
    with zipfile.ZipFile(_here / "app.zip") as zf:
        for name in zf.namelist():
            if name.startswith("/") or ".." in Path(name).parts:
                raise RuntimeError(f"Ruta no permitida en app.zip: {name}")
        zf.extractall(_here)

os.environ.setdefault("CLASSFORGE_DATA_DIR", "/tmp/classforge-data")
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")), proxy_headers=True, forwarded_allow_ips="*")
