#!/usr/bin/env python3
"""Resume un archivo CSV en Markdown: dimensiones, tipos, vacíos y estadísticas por columna.

Uso:
    python3 resumir_csv.py ARCHIVO.csv [--max-valores N] [--separador ";"]

Salida: informe Markdown por la salida estándar.
Códigos de salida: 0 correcto, 1 error en el archivo, 2 uso incorrecto.
Solo usa la biblioteca estándar. No modifica el archivo de entrada.
"""

from __future__ import annotations

import argparse
import csv
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

# Bytes leídos para detectar el separador: suficiente para varias filas típicas.
MUESTRA_DETECCION = 64 * 1024
# Codificaciones probadas en orden: UTF-8 (con o sin BOM) y Latin-1 (Excel en español).
CODIFICACIONES = ("utf-8-sig", "latin-1")
SEPARADORES = ",;\t|"
VALORES_VACIOS = {"", "na", "n/a", "null", "none", "nan", "-"}
# Valores frecuentes que se muestran por columna de texto, por defecto.
MAX_VALORES = 3


def leer(ruta: Path) -> tuple[str, str]:
    datos = ruta.read_bytes()
    for codificacion in CODIFICACIONES:
        try:
            return datos.decode(codificacion), codificacion.replace("-sig", "")
        except UnicodeDecodeError:
            continue
    raise ValueError("no se reconoce la codificación (prueba a guardarlo como CSV UTF-8)")


def detectar_separador(texto: str, forzado: str | None) -> str:
    if forzado:
        return forzado
    try:
        return csv.Sniffer().sniff(texto[:MUESTRA_DETECCION], delimiters=SEPARADORES).delimiter
    except csv.Error:
        return ","


def separador_decimal(valores: list[str]) -> str:
    """Decide si la columna usa coma decimal (1.234,5) o punto decimal (1,234.5).

    Ante valores ambiguos («1.100», «1,100») se asume el formato español: coma decimal.
    """
    for v in valores:
        if re.search(r",\d{1,2}$|,\d{4,}$|\.\d{3},", v):
            return ","
    for v in valores:
        if re.search(r"\.\d{1,2}$|\.\d{4,}$|,\d{3}\.", v):
            return "."
    return ","


def numero(valor: str, decimal: str) -> float | None:
    miles = "." if decimal == "," else ","
    v = valor.strip().replace(" ", "").replace(miles, "").replace(decimal, ".")
    if not re.fullmatch(r"[-+]?\d+(\.\d+)?", v):
        return None
    return float(v)


def formato(n: float) -> str:
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").removesuffix(",00")


def resumir(ruta: Path, max_valores: int, separador: str | None) -> str:
    texto, codificacion = leer(ruta)
    sep = detectar_separador(texto, separador)
    filas = list(csv.reader(texto.splitlines(), delimiter=sep))
    filas = [f for f in filas if any(c.strip() for c in f)]
    if not filas:
        raise ValueError("el archivo está vacío")
    cabecera, datos = filas[0], filas[1:]
    if not datos:
        raise ValueError("solo contiene la fila de cabecera, sin datos")
    irregulares = sum(len(f) != len(cabecera) for f in datos)

    nombre_sep = {",": "coma", ";": "punto y coma", "\t": "tabulador", "|": "barra vertical"}.get(sep, repr(sep))
    salida = [f"# Resumen de `{ruta.name}`", "",
              f"- **Filas de datos:** {len(datos)}",
              f"- **Columnas:** {len(cabecera)}",
              f"- **Separador:** {nombre_sep} · **Codificación:** {codificacion}"]
    if irregulares:
        salida.append(f"- ⚠️ **Filas con nº de columnas distinto a la cabecera:** {irregulares}")
    salida += ["", "| Columna | Tipo | Vacíos | Únicos | Resumen |", "|---|---|---|---|---|"]

    for i, nombre in enumerate(cabecera):
        valores = [f[i].strip() if i < len(f) else "" for f in datos]
        presentes = [v for v in valores if v.lower() not in VALORES_VACIOS]
        vacios = len(valores) - len(presentes)
        nums = [numero(v, separador_decimal(presentes)) for v in presentes]
        if presentes and all(n is not None for n in nums):
            tipo = "numérica"
            resumen = (f"mín {formato(min(nums))} · máx {formato(max(nums))} · "
                       f"media {formato(statistics.fmean(nums))} · mediana {formato(statistics.median(nums))}")
        elif presentes:
            tipo = "texto"
            frecuentes = Counter(presentes).most_common(max_valores)
            resumen = ", ".join(f"{v} ({c})" for v, c in frecuentes).replace("|", "\\|")
        else:
            tipo, resumen = "vacía", "—"
        pct = f"{vacios} ({vacios * 100 // len(valores)} %)"
        salida.append(f"| {nombre.strip() or f'(columna {i + 1})'} | {tipo} | {pct} | {len(set(presentes))} | {resumen} |")
    return "\n".join(salida) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Resume un CSV en Markdown.")
    parser.add_argument("archivo", help="ruta del archivo .csv")
    parser.add_argument("--max-valores", type=int, default=MAX_VALORES,
                        help=f"valores frecuentes por columna de texto (por defecto {MAX_VALORES})")
    parser.add_argument("--separador", help="fuerza el separador (por defecto se detecta)")
    args = parser.parse_args(argv)
    ruta = Path(args.archivo)
    if not ruta.is_file():
        print(f"Error: no existe el archivo «{ruta}». Comprueba la ruta.", file=sys.stderr)
        return 2
    try:
        print(resumir(ruta, max(1, args.max_valores), args.separador), end="")
    except (ValueError, csv.Error, OSError) as e:
        print(f"Error en «{ruta}»: {e}.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
