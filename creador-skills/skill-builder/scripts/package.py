#!/usr/bin/env python3
"""Empaqueta una skill en un .zip listo para subir a claude.ai.

Uso:
    python3 package.py RUTA_SKILL [--salida CARPETA] [--incluir-tests] [--estricto]

El ZIP contiene la carpeta de la skill como raíz (mi-skill.zip → mi-skill/SKILL.md),
que es el formato que pide claude.ai. Antes de empaquetar ejecuta validate.py con
destino claude.ai y se niega a continuar si hay errores bloqueantes.

Se excluyen: cachés (__pycache__, *.pyc), archivos y carpetas ocultos (.env, .git…),
temporales (*.tmp, *.bak, *~) y, salvo --incluir-tests, las carpetas tests/ y evals/.

El paquete es reproducible: mismos archivos → mismo ZIP (fechas fijas y orden estable).
Solo escribe en la carpeta de salida (por defecto ./dist).

Códigos de salida: 0 paquete creado, 1 validación fallida o error al crear, 2 uso incorrecto.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import archivos_de_skill, validar_skill  # noqa: E402

FECHA_FIJA = (1980, 1, 1, 0, 0, 0)  # Fecha mínima de ZIP: hace el paquete reproducible


def empaquetar(ruta_skill: Path, salida: Path, incluir_tests: bool = False, estricto: bool = False) -> Path | None:
    raiz = ruta_skill.expanduser().resolve()
    print(f"🔍 Validando «{raiz.name}» para claude.ai…\n")
    informe = validar_skill(raiz, destino="claudeai", estricto=estricto)
    print(informe.texto())
    if not informe.valido:
        print("\n⛔ No se ha creado el paquete: la skill tiene errores bloqueantes.")
        return None

    archivos = archivos_de_skill(raiz, incluir_pruebas=incluir_tests)
    salida = salida.expanduser().resolve()
    try:
        salida.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print(f"❌ No se puede crear la carpeta de salida «{salida}»: {e}")
        return None
    destino = salida / f"{raiz.name}.zip"
    if destino.resolve().is_relative_to(raiz):
        print(f"❌ La carpeta de salida no puede estar dentro de la skill ({salida}).\n"
              "   → Cómo solucionarlo: usa --salida con una carpeta externa, p. ej. ./dist")
        return None

    temporal = destino.with_suffix(".zip.parcial")
    print(f"\n📦 Creando {destino}")
    try:
        with zipfile.ZipFile(temporal, "w", zipfile.ZIP_DEFLATED) as zf:
            for archivo in archivos:
                nombre_zip = f"{raiz.name}/{archivo.relative_to(raiz).as_posix()}"
                info = zipfile.ZipInfo(nombre_zip, date_time=FECHA_FIJA)
                info.compress_type = zipfile.ZIP_DEFLATED
                ejecutable = archivo.stat().st_mode & 0o111
                info.external_attr = (0o755 if ejecutable else 0o644) << 16
                zf.writestr(info, archivo.read_bytes())
                print(f"   + {nombre_zip}")
        temporal.replace(destino)
    except OSError as e:
        temporal.unlink(missing_ok=True)
        print(f"❌ Error al escribir el paquete: {e}")
        return None

    # Verificación del paquete generado
    with zipfile.ZipFile(destino) as zf:
        nombres = zf.namelist()
        corrupto = zf.testzip()
    raices = {n.split("/", 1)[0] for n in nombres}
    if corrupto or raices != {raiz.name} or f"{raiz.name}/SKILL.md" not in nombres:
        print("❌ El paquete generado no tiene la estructura esperada; se elimina.")
        destino.unlink(missing_ok=True)
        return None
    omitidos = "" if incluir_tests else " (sin tests/)"
    print(f"\n✅ Paquete creado: {destino} – {len(nombres)} archivos{omitidos}.")
    print("   Súbelo en claude.ai → Customize > Skills (o Settings > Features) → Añadir/Upload.")
    return destino


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Valida y empaqueta una skill en un .zip para claude.ai.")
    parser.add_argument("ruta", help="carpeta de la skill (la que contiene SKILL.md)")
    parser.add_argument("--salida", default="dist", help="carpeta donde guardar el .zip (por defecto: ./dist)")
    parser.add_argument("--incluir-tests", action="store_true", help="incluye las carpetas tests/ y evals/")
    parser.add_argument("--estricto", action="store_true",
                        help="exige descripción de 200 caracteres como máximo (centro de ayuda de claude.ai)")
    args = parser.parse_args(argv)
    ruta = Path(args.ruta)
    if not ruta.expanduser().is_dir():
        print(f"❌ La carpeta «{args.ruta}» no existe. Indica la carpeta que contiene SKILL.md.", file=sys.stderr)
        return 2
    return 0 if empaquetar(ruta, Path(args.salida), args.incluir_tests, args.estricto) else 1


if __name__ == "__main__":
    sys.exit(main())
