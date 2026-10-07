#!/usr/bin/env python3
"""Instala una skill en Claude Code (skills personales o del proyecto).

Uso:
    python3 install.py RUTA_SKILL --ambito personal
    python3 install.py RUTA_SKILL --ambito proyecto [--proyecto CARPETA_PROYECTO]
    Añade --si para confirmar el reemplazo sin preguntar (modo no interactivo).

Destinos:
    personal → ~/.claude/skills/<nombre>/
    proyecto → <proyecto>/.claude/skills/<nombre>/   (por defecto, la carpeta actual)

Si ya existe una skill con ese nombre, pide confirmación y, antes de reemplazarla,
guarda una copia de seguridad con fecha en <base>/.claude/skill-backups/<nombre>-AAAAMMDD-HHMMSS/.
Las copias se guardan fuera de .claude/skills/ para que Claude Code no las cargue como
skills duplicadas. Solo escribe dentro de <base>/.claude/skills/<nombre> y de esa
carpeta de copias.

Códigos de salida: 0 instalada, 1 cancelada o error, 2 uso incorrecto.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import archivos_de_skill, validar_skill  # noqa: E402


def carpeta_base(ambito: str, proyecto: str | None) -> Path:
    if ambito == "personal":
        return Path.home() / ".claude"
    return Path(proyecto or ".").expanduser().resolve() / ".claude"


def confirmar(pregunta: str) -> bool:
    if not sys.stdin.isatty():
        return False
    try:
        return input(f"{pregunta} [s/N]: ").strip().lower() in ("s", "si", "sí", "y", "yes")
    except EOFError:
        return False


def instalar(ruta_skill: Path, ambito: str, proyecto: str | None = None, si: bool = False) -> bool:
    origen = ruta_skill.expanduser().resolve()
    print(f"🔍 Validando «{origen.name}» para Claude Code…\n")
    informe = validar_skill(origen, destino="claude-code")
    print(informe.texto())
    if not informe.valido:
        print("\n⛔ No se instala: la skill tiene errores bloqueantes.")
        return False
    nombre = informe.nombre or origen.name

    base = carpeta_base(ambito, proyecto)
    skills = base / "skills"
    destino = (skills / nombre).resolve()
    if destino.parent != skills.resolve():
        print(f"❌ Destino no válido: {destino}")
        return False
    if origen == destino or destino in origen.parents or origen in destino.parents:
        print(f"❌ El origen y el destino se solapan ({origen}). Instala desde una carpeta de trabajo distinta.")
        return False

    print(f"\n📁 Destino ({ambito}): {destino}")
    copia = None
    if destino.exists() or destino.is_symlink():
        print(f"⚠️  Ya existe una skill llamada «{nombre}» en {destino}.")
        if not (si or confirmar("¿Reemplazarla (se guardará antes una copia de seguridad)?")):
            print("⏹  Instalación cancelada: no se ha modificado nada.\n"
                  "   → Para reemplazarla sin preguntar, añade --si.")
            return False
        marca = datetime.now().strftime("%Y%m%d-%H%M%S")
        copia = base / "skill-backups" / f"{nombre}-{marca}"
        sufijo = 1
        while copia.exists():
            copia = base / "skill-backups" / f"{nombre}-{marca}-{sufijo}"
            sufijo += 1
        try:
            copia.parent.mkdir(parents=True, exist_ok=True)
            if destino.is_symlink():
                copia.symlink_to(destino.readlink())
                destino.unlink()
            else:
                shutil.copytree(destino, copia, symlinks=True)
                shutil.rmtree(destino)
        except OSError as e:
            print(f"❌ No se pudo crear la copia de seguridad ({e}). No se ha reemplazado nada.")
            return False
        print(f"💾 Copia de seguridad: {copia}")

    try:
        for archivo in archivos_de_skill(origen):
            rel = archivo.relative_to(origen)
            (destino / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(archivo, destino / rel)
    except OSError as e:
        print(f"❌ Error al copiar: {e}")
        if copia:
            print(f"   La versión anterior está a salvo en {copia}; puedes restaurarla copiándola a {destino}.")
        return False

    print(f"\n✅ Skill «{nombre}» instalada en {destino}.")
    print("   Claude Code la detecta sin reiniciar; compruébalo con /skills o invócala con "
          f"/{nombre}. Si es una carpeta nueva no vigilada, usa /reload-skills.")
    return True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Instala una skill en Claude Code con copia de seguridad.")
    parser.add_argument("ruta", help="carpeta de la skill (la que contiene SKILL.md)")
    parser.add_argument("--ambito", choices=("personal", "proyecto"), required=True,
                        help="personal: ~/.claude/skills · proyecto: <proyecto>/.claude/skills")
    parser.add_argument("--proyecto", help="carpeta raíz del proyecto (solo con --ambito proyecto; por defecto, la actual)")
    parser.add_argument("--si", action="store_true",
                        help="confirma el reemplazo de una skill existente (siempre con copia de seguridad)")
    args = parser.parse_args(argv)
    if not Path(args.ruta).expanduser().is_dir():
        print(f"❌ La carpeta «{args.ruta}» no existe. Indica la carpeta que contiene SKILL.md.", file=sys.stderr)
        return 2
    if args.proyecto and args.ambito != "proyecto":
        print("❌ --proyecto solo se usa con --ambito proyecto.", file=sys.stderr)
        return 2
    return 0 if instalar(Path(args.ruta), args.ambito, args.proyecto, args.si) else 1


if __name__ == "__main__":
    sys.exit(main())
