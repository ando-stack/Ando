"""Descarga la biblioteca curada de fuentes libres (Google Fonts, licencia OFL/Apache)
a assets/fonts y genera assets/fonts/manifest.json con la suma SHA-256 de cada archivo.

Solo lo necesita quien mantenga el proyecto: las fuentes ya vienen incluidas en el
repositorio. scripts/instalar.py verifica las sumas del manifiesto.

Uso:  python scripts/construir_biblioteca_fuentes.py
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "assets" / "fonts"
BASE = "https://raw.githubusercontent.com/google/fonts/main"

# carpeta en google/fonts -> (categoría, pesos que se usan al comparar)
FAMILIAS: dict[str, tuple[str, list[int]]] = {
    "ofl/anton": ("impacto", [400]),
    "ofl/bebasneue": ("impacto", [400]),
    "ofl/oswald": ("condensada", [500, 700]),
    "ofl/montserrat": ("sans", [700, 900]),
    "ofl/bangers": ("comic", [400]),
    "ofl/archivoblack": ("impacto", [400]),
    "ofl/russoone": ("deportiva", [400]),
    "ofl/teko": ("deportiva", [500, 700]),
    "ofl/barlowcondensed": ("condensada", [700, 900]),
    "ofl/staatliches": ("deportiva", [400]),
    "ofl/blackopsone": ("deportiva", [400]),
    "ofl/poppins": ("sans", [700, 900]),
    "ofl/roboto": ("sans", [400, 900]),
    "ofl/robotocondensed": ("condensada", [700]),
    "ofl/lilitaone": ("redondeada", [400]),
    "ofl/passionone": ("impacto", [400, 700]),
    "ofl/righteous": ("display", [400]),
    "ofl/alfaslabone": ("serif", [400]),
    "ofl/fjallaone": ("condensada", [400]),
    "ofl/leaguegothic": ("condensada", [400]),
    "ofl/rubik": ("sans", [700, 900]),
    "ofl/inter": ("sans", [400, 800]),
    "ofl/bowlbyone": ("impacto", [400]),
    "ofl/titanone": ("redondeada", [400]),
    "ofl/bungee": ("display", [400]),
    "ofl/changaone": ("impacto", [400]),
    "ofl/squadaone": ("deportiva", [400]),
    "ofl/kanit": ("sans", [700, 900]),
    "ofl/abrilfatface": ("serif", [400]),
    "ofl/pacifico": ("manuscrita", [400]),
    "ofl/lobster": ("manuscrita", [400]),
    "ofl/orbitron": ("tecno", [700, 900]),
    "ofl/audiowide": ("tecno", [400]),
    "ofl/racingsansone": ("deportiva", [400]),
    "ofl/playfairdisplay": ("serif", [700, 900]),
    "ofl/opensans": ("sans", [400, 800]),
    "ofl/lato": ("sans", [400, 900]),
    "ofl/nunito": ("redondeada", [800]),
    "ofl/caveat": ("manuscrita", [700]),
    "ofl/shrikhand": ("display", [400]),
    "ofl/chakrapetch": ("tecno", [700]),
    "ofl/exo2": ("tecno", [800]),
    "ofl/sairacondensed": ("condensada", [800]),
    "ofl/sixcaps": ("condensada", [400]),
    "ofl/dmserifdisplay": ("serif", [400]),
}


def bajar(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def main() -> int:
    DESTINO.mkdir(parents=True, exist_ok=True)
    manifiesto = []
    for carpeta, (categoria, pesos) in FAMILIAS.items():
        try:
            meta = bajar(f"{BASE}/{carpeta}/METADATA.pb").decode("utf-8")
        except Exception as e:  # familia movida o retirada
            print(f"AVISO: {carpeta} no disponible ({e}); se omite")
            continue
        nombre = re.search(r'^name: "(.+)"', meta, re.M).group(1)
        licencia = re.search(r'^license: "(.+)"', meta, re.M).group(1)
        disenador = re.search(r'^designer: "(.+)"', meta, re.M).group(1)
        # solo estilos normales (no cursivas)
        bloques = re.findall(r"fonts \{(.*?)\n\}", meta, re.S)
        archivos = []
        for b in bloques:
            if 'style: "normal"' not in b:
                continue
            fn = re.search(r'filename: "(.+)"', b).group(1)
            peso = int(re.search(r"weight: (\d+)", b).group(1))
            archivos.append((fn, peso))
        variable = any("[" in fn for fn, _ in archivos)
        elegidos = []
        if variable:
            elegidos = [archivos[0][0]]
        else:
            for p in pesos:
                mejor = min(archivos, key=lambda a: abs(a[1] - p))[0]
                if mejor not in elegidos:
                    elegidos.append(mejor)
        sub = DESTINO / carpeta.split("/")[1]
        sub.mkdir(exist_ok=True)
        ficheros = []
        for fn in elegidos:
            datos = bajar(f"{BASE}/{carpeta}/{fn}")
            (sub / fn).write_bytes(datos)
            peso_archivo = next(p for f, p in archivos if f == fn)
            ficheros.append({
                "archivo": f"{sub.name}/{fn}",
                "variable": "[" in fn,
                "peso": peso_archivo,
                "sha256": hashlib.sha256(datos).hexdigest(),
                "bytes": len(datos),
            })
        lic = "OFL.txt" if licencia == "OFL" else "LICENSE.txt"
        datos = bajar(f"{BASE}/{carpeta}/{lic}")
        (sub / lic).write_bytes(datos)
        manifiesto.append({
            "familia": nombre,
            "carpeta": sub.name,
            "categoria": categoria,
            "pesos": pesos,
            "licencia": licencia,
            "disenador": disenador,
            "origen": f"https://github.com/google/fonts/tree/main/{carpeta}",
            "archivo_licencia": f"{sub.name}/{lic}",
            "ficheros": ficheros,
        })
        print(f"OK {nombre}: {[f['archivo'] for f in ficheros]}")
    (DESTINO / "manifest.json").write_text(json.dumps(manifiesto, indent=1, ensure_ascii=False), "utf-8")
    print(f"{len(manifiesto)} familias")
    return 0


if __name__ == "__main__":
    sys.exit(main())
