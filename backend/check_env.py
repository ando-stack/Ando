"""Comprueba los requisitos: Python 3.11+, Node.js 18+ y FFmpeg/ffprobe.
Si falta algo, se detiene y explica cómo instalarlo en Windows, macOS y Linux."""
import re
import shutil
import subprocess
import sys

HELP = {
    "python": """Python 3.11 o superior:
  · Windows: https://www.python.org/downloads/ (marca «Add Python to PATH») o  winget install Python.Python.3.12
  · macOS:   brew install python@3.12
  · Linux:   sudo apt install python3.12 python3.12-venv   (o el gestor de tu distribución)""",
    "node": """Node.js 18 o superior:
  · Windows: https://nodejs.org (versión LTS) o  winget install OpenJS.NodeJS.LTS
  · macOS:   brew install node
  · Linux:   https://github.com/nodesource/distributions  o  sudo apt install nodejs npm (comprueba que sea ≥ 18)""",
    "ffmpeg": """FFmpeg (incluye ffprobe):
  · Windows: winget install Gyan.FFmpeg   (o https://www.gyan.dev/ffmpeg/builds/ y añade la carpeta bin al PATH)
  · macOS:   brew install ffmpeg
  · Linux:   sudo apt install ffmpeg""",
}


def version_of(cmd):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return (out.stdout + out.stderr).strip()
    except (OSError, subprocess.TimeoutExpired):
        return None


def main() -> int:
    problems = []
    py = sys.version_info
    print(f"Python  {py.major}.{py.minor}.{py.micro}", "✓" if py >= (3, 11) else "✗ (se necesita 3.11+)")
    if py < (3, 11):
        problems.append("python")
    node = version_of(["node", "--version"]) if shutil.which("node") else None
    m = re.search(r"v(\d+)", node or "")
    ok = bool(m and int(m.group(1)) >= 18)
    print(f"Node.js {node or 'no encontrado'}", "✓" if ok else "✗ (se necesita 18+)")
    if not ok:
        problems.append("node")
    ff = version_of(["ffmpeg", "-version"]) if shutil.which("ffmpeg") else None
    fp = shutil.which("ffprobe")
    print(f"FFmpeg  {(ff or 'no encontrado').splitlines()[0][:60]}", "✓" if ff and fp else "✗")
    if not (ff and fp):
        problems.append("ffmpeg")
    if problems:
        print("\nFalta algo. Instálalo y vuelve a ejecutar este script:\n")
        for p in problems:
            print(HELP[p] + "\n")
        return 1
    print("\nTodo listo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
