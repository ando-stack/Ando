"""Conversión y recálculo con LibreOffice en modo headless (opcional).

Si LibreOffice no está instalado, las funciones lanzan ``ConversionUnavailable``
y el resto del sistema lo indica claramente en lugar de simular el resultado."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from .config import settings
from .tools.base import OpError

_lock = threading.Lock()  # LibreOffice no tolera bien instancias concurrentes con el mismo perfil


class ConversionUnavailable(OpError):
    pass


def soffice() -> str | None:
    return settings.soffice_path or shutil.which("soffice") or shutil.which("libreoffice")


def _run(src: Path, out_dir: Path, target: str, timeout: int = 120) -> Path:
    exe = soffice()
    if not exe:
        raise ConversionUnavailable("LibreOffice no está instalado en el servidor: no se puede convertir a PDF ni recalcular fórmulas.")
    out_dir.mkdir(parents=True, exist_ok=True)
    with _lock, tempfile.TemporaryDirectory(prefix="cf-lo-") as profile:
        cmd = [exe, f"-env:UserInstallation=file://{profile}", "--headless", "--norestore", "--nologo",
               "--convert-to", target, "--outdir", str(out_dir), str(src)]
        try:
            subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired as e:
            raise OpError("LibreOffice tardó demasiado en convertir el archivo.") from e
    ext = target.split(":")[0]
    out = out_dir / (src.stem + "." + ext)
    if not out.exists():
        raise OpError(f"LibreOffice no pudo convertir «{src.name}».")
    return out


def convert_to_pdf(src: Path, work_dir: Path) -> Path:
    return _run(src, work_dir / "pdf_conv", "pdf")


def recalculated_copy(xlsx: Path, work_dir: Path) -> Path:
    """Devuelve una copia del libro con todas las fórmulas calculadas por LibreOffice."""
    d = work_dir / "recalc"
    d.mkdir(parents=True, exist_ok=True)
    tmp_src = d / ("src_" + xlsx.name)
    shutil.copyfile(xlsx, tmp_src)
    out = _run(tmp_src, d / "out", "xlsx:Calc MS Excel 2007 XML")
    return out
