"""Instalador del Estudio de Capas.

  python scripts/instalar.py              instala todo (entorno, dependencias, modelos, editor)
  python scripts/instalar.py --modelos    solo descarga/verifica los modelos
  python scripts/instalar.py --cpu        fuerza PyTorch sin CUDA
  python scripts/instalar.py --sin-web    no compila el editor (necesita Node.js 18+)
  python scripts/instalar.py --comprobar  solo comprueba requisitos (Python, Node, GPU)

Todo es gratuito y local. Las descargas de modelos se verifican con sus sumas de control.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import venv
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
VENV = RAIZ / ".venv"
ES_WIN = os.name == "nt"
PY_VENV = VENV / ("Scripts/python.exe" if ES_WIN else "bin/python")


def titulo(t: str) -> None:
    print(f"\n=== {t} ===", flush=True)


def ejecutar(cmd: list[str], **kw) -> None:
    print("  $", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def comprobar_requisitos() -> dict:
    titulo("Comprobando requisitos")
    ok = True
    v = sys.version_info
    print(f"  Python {v.major}.{v.minor}.{v.micro}", "✔" if v >= (3, 10) else "✘ (se necesita 3.10 o superior)")
    if v < (3, 10):
        ok = False
        print("    Instálalo desde https://www.python.org/downloads/ (marca «Add to PATH» en Windows).")
    node = shutil.which("node")
    version_node = None
    if node:
        version_node = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        mayor = int(version_node.lstrip("v").split(".")[0])
        print(f"  Node.js {version_node}", "✔" if mayor >= 18 else "✘ (se necesita 18 o superior)")
        if mayor < 18:
            ok = False
    else:
        print("  Node.js no encontrado ✘ — instálalo desde https://nodejs.org (versión LTS) para compilar el editor.")
    gpu = "cpu"
    if shutil.which("nvidia-smi"):
        r = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            gpu = "cuda"
            print(f"  GPU NVIDIA: {r.stdout.strip()} ✔ (se usará CUDA)")
        else:
            print("  nvidia-smi presente pero sin GPU utilizable: revisa los controladores de NVIDIA. Se usará la CPU.")
    elif platform.system() == "Darwin" and platform.machine() == "arm64":
        gpu = "mps"
        print("  Apple Silicon ✔ (se usará MPS)")
    else:
        print("  Sin GPU compatible: se usará la CPU (funciona, pero más lento: ~40-70 s por imagen).")
    try:
        import psutil  # type: ignore

        ram = psutil.virtual_memory().total / 1e9
        print(f"  RAM: {ram:.1f} GB", "✔" if ram >= 12 else "(con menos de 12 GB se usa un recorte más ligero)")
    except Exception:
        pass
    libre = shutil.disk_usage(RAIZ).free / 1e9
    print(f"  Disco libre: {libre:.1f} GB", "✔" if libre >= 6 else "✘ (se necesitan ~6 GB: dependencias + 1,7 GB de modelos)")
    return {"ok": ok, "node": bool(node and version_node), "gpu": gpu}


def crear_entorno() -> None:
    titulo("Entorno virtual")
    if PY_VENV.exists():
        ok = subprocess.run([str(PY_VENV), "-m", "pip", "--version"], capture_output=True).returncode == 0
        if ok:
            print("  .venv ya existe")
            return
        print("  .venv está incompleto (quizá se interrumpió la instalación): se vuelve a crear")
        shutil.rmtree(VENV, ignore_errors=True)
    print("  Creando .venv… (puede tardar 1-3 minutos sin mostrar nada; no lo interrumpas)", flush=True)
    venv.EnvBuilder(with_pip=True).create(VENV)
    print("  creado .venv")


def instalar_dependencias(gpu: str, forzar_cpu: bool) -> None:
    titulo("Dependencias de Python (versiones fijadas)")
    print("  Descarga varios cientos de MB (con GPU NVIDIA, ~2,5 GB): puede tardar 5-15 minutos.", flush=True)
    ejecutar([str(PY_VENV), "-m", "pip", "install", "--upgrade", "pip"])
    reqs = (RAIZ / "requirements.txt").read_text("utf-8").splitlines()
    torch = [r for r in reqs if r.startswith(("torch==", "torchvision=="))]
    resto = RAIZ / ".venv" / "requirements-sin-torch.txt"
    resto.write_text("\n".join(r for r in reqs if not r.startswith(("torch==", "torchvision=="))), "utf-8")
    if gpu == "cuda" and not forzar_cpu:
        indice = ["--index-url", "https://download.pytorch.org/whl/cu126"]
    elif gpu == "mps" or platform.system() == "Darwin":
        indice = []
    else:
        indice = ["--index-url", "https://download.pytorch.org/whl/cpu"]
    ejecutar([str(PY_VENV), "-m", "pip", "install", *torch, *indice])
    ejecutar([str(PY_VENV), "-m", "pip", "install", "-r", str(resto)])
    if gpu == "cuda" and not forzar_cpu:
        print("  Para acelerar también los modelos ONNX en la GPU: .venv/bin/pip install onnxruntime-gpu (opcional)")


def descargar_modelos() -> None:
    titulo("Modelos de IA (descarga y verificación)")
    codigo = r"""
import sys
sys.path.insert(0, %r)
from engine.models import registry as r
fallos = 0
for clave, m in r.MODELOS.items():
    try:
        print(f"  {clave:14s} {m.descripcion} [{m.licencia}] ~{m.tamano_mb} MB ...", flush=True)
        r.descargar(clave, progreso=None)
        print(f"  {clave:14s} OK (verificado)", flush=True)
    except Exception as e:
        fallos += 1
        print(f"  {clave:14s} ERROR: {e}", flush=True)
sys.exit(1 if fallos else 0)
""" % str(RAIZ)
    ejecutar([str(PY_VENV), "-c", codigo])


def verificar_fuentes() -> None:
    titulo("Fuentes libres incluidas (assets/fonts)")
    manifest = json.loads((RAIZ / "assets/fonts/manifest.json").read_text("utf-8"))
    malos = 0
    n = 0
    for fam in manifest:
        for f in fam["ficheros"]:
            n += 1
            p = RAIZ / "assets/fonts" / f["archivo"]
            if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest() != f["sha256"]:
                malos += 1
                print(f"  ✘ {f['archivo']} falta o está dañada")
    print(f"  {n - malos}/{n} archivos de fuente verificados ({len(manifest)} familias)")
    if malos:
        raise SystemExit("Hay fuentes dañadas: vuelve a descargar el repositorio.")


def compilar_web() -> None:
    titulo("Editor web (React + Vite)")
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        print("  npm no encontrado: instala Node.js 18+ y vuelve a ejecutar el instalador.")
        return
    web = RAIZ / "web"
    ejecutar([npm, "ci" if (web / "package-lock.json").exists() else "install"], cwd=web)
    ejecutar([npm, "run", "build"], cwd=web)


def preparar_env() -> None:
    env = RAIZ / ".env"
    if not env.exists():
        shutil.copy(RAIZ / ".env.example", env)
        print("\n  Creado .env a partir de .env.example (opciones en la nube desactivadas).")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelos", action="store_true", help="solo descargar y verificar los modelos")
    ap.add_argument("--cpu", action="store_true", help="instalar PyTorch sin CUDA")
    ap.add_argument("--sin-web", action="store_true", help="no compilar el editor web")
    ap.add_argument("--comprobar", action="store_true", help="solo comprobar requisitos")
    a = ap.parse_args()
    req = comprobar_requisitos()
    if a.comprobar:
        return 0 if req["ok"] else 1
    if not req["ok"]:
        print("\nCorrige los requisitos marcados con ✘ y vuelve a ejecutar el instalador.")
        return 1
    if a.modelos:
        if not PY_VENV.exists():
            print("Primero instala las dependencias: python scripts/instalar.py")
            return 1
        descargar_modelos()
        return 0
    crear_entorno()
    instalar_dependencias(req["gpu"], a.cpu)
    descargar_modelos()
    verificar_fuentes()
    if not a.sin_web:
        compilar_web()
    preparar_env()
    titulo("Listo")
    print("  Arranca con:  scripts/iniciar.sh   (Windows: scripts\\iniciar.bat)")
    print("  y abre http://127.0.0.1:8000")
    return 0


if __name__ == "__main__":
    sys.exit(main())
