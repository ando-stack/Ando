"""Umbrales y ajustes globales. Se pueden sobrescribir con variables de entorno (.env)."""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
if load_dotenv:
    load_dotenv(ROOT / ".env")

PROJECTS_DIR = Path(os.getenv("PROJECTS_DIR", ROOT / "projects")).resolve()
ASSETS_DIR = ROOT / "assets"
FRONTEND_DIR = ROOT / "frontend"

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
PUBLIC_URL = os.getenv("PUBLIC_URL", f"http://{HOST}:{PORT}")

# ---------------------------------------------------------------- IA
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5")


def ai_available() -> bool:
    if os.getenv("EDITOR_FAKE_AI"):  # simulador de pruebas (backend/tests/fake_claude.py)
        return True
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


# ---------------------------------------------------------------- importación
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
PROXY_HEIGHT = int(os.getenv("PROXY_HEIGHT", "540"))
PROXY_CRF = 28

# Agrupación: pesos de cada señal y umbral para considerar que dos clips son consecutivos
GROUP_MAX_GAP_SECONDS = 15 * 60       # separación máxima entre fin de un clip y el siguiente
GROUP_LINK_THRESHOLD = 0.55
GROUP_WEIGHTS = {"time": 0.35, "name": 0.2, "format": 0.15, "visual": 0.15, "text": 0.15}

# ---------------------------------------------------------------- transcripción
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")

# ---------------------------------------------------------------- limpieza
FILLER_WORDS = {
    "eh", "ehh", "ehm", "em", "emm", "mm", "mmm", "hmm", "este", "esto", "pues", "bueno",
    "o sea", "en plan", "vale", "tipo", "osea", "ah", "uh", "um", "uhm",
}
# Muletillas "fuertes": se quitan siempre; las demás solo si van aisladas entre pausas
FILLER_ALWAYS = {"eh", "ehh", "ehm", "em", "emm", "mm", "mmm", "hmm", "uh", "um", "uhm", "ah"}

# ---------------------------------------------------------------- color
COLOR_TARGET_LUMA = 0.45        # luminancia media objetivo (0..1)
COLOR_LUMA_RANGE = (0.33, 0.62)  # fuera de este rango -> corregir exposición
COLOR_MIN_CONTRAST = 0.12       # desviación típica de luma mínima
COLOR_MAX_TEMP_BIAS = 0.05      # diferencia R-B normalizada tolerada
COLOR_MAX_TINT_BIAS = 0.04
COLOR_SAT_RANGE = (0.06, 0.40)   # croma media (max-min de RGB)
LUT_SIZE = 33

# ---------------------------------------------------------------- caras
FACE_SAMPLE_FPS = 10            # fotogramas por segundo analizados
FACE_MIN_CONFIDENCE = 0.5
FACE_MAX_GAP = 0.6              # huecos (s) que se rellenan interpolando
FACE_UNRELIABLE_GAP = 0.3       # huecos mayores se marcan como "no fiable"

# ---------------------------------------------------------------- render
REMOTION_BROWSER = os.getenv("REMOTION_BROWSER_EXECUTABLE") or None
RENDER_CONCURRENCY = os.getenv("RENDER_CONCURRENCY")
