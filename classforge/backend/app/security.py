"""Seguridad: propiedad de trabajos, límites de uso, validación de archivos y
detección de instrucciones maliciosas incrustadas en documentos."""
from __future__ import annotations

import hashlib
import hmac
import io
import re
import threading
import time
import zipfile
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request

from .config import settings

CLIENT_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


# --------------------------------------------------------------------------- #
# Identidad del cliente
# --------------------------------------------------------------------------- #
def hash_token(token: str) -> str:
    return hashlib.sha256(("classforge:" + token).encode()).hexdigest()


def client_token(x_client_token: str | None = Header(default=None)) -> str:
    """Cada navegador genera un token aleatorio (localStorage) y lo envía en
    ``X-Client-Token``. Solo guardamos su hash; sin él no se puede acceder a un trabajo."""
    if not x_client_token or not CLIENT_TOKEN_RE.match(x_client_token):
        raise HTTPException(401, "Falta o es inválido el identificador de cliente (X-Client-Token).")
    return x_client_token


def owns(job: dict, token: str) -> bool:
    return hmac.compare_digest(job.get("owner_hash", ""), hash_token(token))


# --------------------------------------------------------------------------- #
# Límites de uso (ventana deslizante en memoria)
# --------------------------------------------------------------------------- #
class RateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: int) -> None:
        now = time.time()
        with self._lock:
            q = self._events[key]
            while q and q[0] < now - window_s:
                q.popleft()
            if len(q) >= limit:
                retry = int(window_s - (now - q[0])) + 1
                raise HTTPException(429, f"Has alcanzado el límite de uso. Inténtalo de nuevo en {retry} s.", headers={"Retry-After": str(retry)})
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def limit_jobs(token: str, request: Request) -> None:
    limiter.check(f"jobs:{hash_token(token)}", settings.jobs_per_day, 86400)
    limiter.check(f"jobs-ip:{client_ip(request)}", settings.jobs_per_day * 3, 86400)


def limit_ai(token: str, request: Request) -> None:
    limiter.check(f"ai:{hash_token(token)}", settings.ai_calls_per_hour, 3600)
    limiter.check(f"ai-ip:{client_ip(request)}", settings.ai_calls_per_hour * 3, 3600)


# --------------------------------------------------------------------------- #
# Validación de archivos subidos
# --------------------------------------------------------------------------- #
ALLOWED = {
    "docx": "docx", "xlsx": "xlsx", "xlsm": "xlsx", "pptx": "pptx", "pdf": "pdf",
    "csv": "csv", "txt": "txt", "md": "txt", "png": "image", "jpg": "image", "jpeg": "image",
}
ZIP_REQUIRED_ENTRY = {"docx": "word/document.xml", "xlsx": "xl/workbook.xml", "xlsm": "xl/workbook.xml", "pptx": "ppt/presentation.xml"}
MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024
MAX_ZIP_ENTRIES = 5000


class FileRejected(Exception):
    pass


def validate_upload(filename: str, data: bytes) -> str:
    """Valida extensión, tamaño y firma real del archivo. Devuelve el tipo lógico."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED:
        raise FileRejected(f"«{filename}»: tipo no admitido. Formatos válidos: {', '.join(sorted(ALLOWED))}.")
    if len(data) == 0:
        raise FileRejected(f"«{filename}» está vacío.")
    if len(data) > settings.max_file_mb * 1024 * 1024:
        raise FileRejected(f"«{filename}» supera el máximo de {settings.max_file_mb} MB.")

    if ext in ZIP_REQUIRED_ENTRY:
        if not data.startswith(b"PK"):
            raise FileRejected(f"«{filename}» no es un archivo de Office válido.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                infos = zf.infolist()
                if len(infos) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_ZIP_UNCOMPRESSED:
                    raise FileRejected(f"«{filename}» es sospechosamente grande al descomprimir.")
                names = {i.filename for i in infos}
                if ZIP_REQUIRED_ENTRY[ext] not in names:
                    raise FileRejected(f"«{filename}» no tiene la estructura de un .{ext}.")
                if ext == "xlsx" and "xl/vbaProject.bin" in names:
                    raise FileRejected(f"«{filename}» contiene macros; guárdalo como .xlsx sin macros.")
        except zipfile.BadZipFile as e:
            raise FileRejected(f"«{filename}» está dañado.") from e
    elif ext == "pdf":
        if b"%PDF" not in data[:1024]:
            raise FileRejected(f"«{filename}» no es un PDF válido.")
    elif ext == "png":
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise FileRejected(f"«{filename}» no es un PNG válido.")
    elif ext in ("jpg", "jpeg"):
        if not data.startswith(b"\xff\xd8\xff"):
            raise FileRejected(f"«{filename}» no es un JPG válido.")
    elif ext in ("csv", "txt", "md"):
        if b"\x00" in data[:8192]:
            raise FileRejected(f"«{filename}» no parece un archivo de texto.")
    return ALLOWED[ext]


# --------------------------------------------------------------------------- #
# Detección heurística de inyección de instrucciones
# --------------------------------------------------------------------------- #
INJECTION_PATTERNS = [
    (r"ignor(a|e|ar)\s+(todas\s+)?(las\s+)?(instrucciones|indicaciones|reglas)\s+(anteriores|previas|del sistema)", "Pide ignorar instrucciones anteriores"),
    (r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)", "Pide ignorar instrucciones anteriores"),
    (r"(system\s*prompt|prompt\s+del\s+sistema|mensaje\s+del\s+sistema)", "Hace referencia al prompt del sistema"),
    (r"(you\s+are\s+now|ahora\s+eres|act[úu]a\s+como\s+(un\s+)?(administrador|root|desarrollador))", "Intenta cambiar el rol de la IA"),
    (r"(api[\s_-]?key|clave\s+de\s+(la\s+)?api|anthropic_api_key|contraseñ?a\s+del\s+servidor)", "Solicita claves o secretos"),
    (r"(ejecuta|execute|run)\s+(este\s+|the\s+following\s+)?(c[óo]digo|code|script|comando|command)", "Pide ejecutar código"),
    (r"(os\.system|subprocess|eval\(|exec\(|import\s+os|rm\s+-rf|powershell|curl\s+http)", "Contiene código potencialmente peligroso"),
    (r"(otros\s+usuarios|other\s+users|archivos\s+de\s+otros|/etc/passwd|\.\./)", "Intenta acceder a datos ajenos o rutas del sistema"),
    (r"(env[ií]a|send|sube|upload)\s+.{0,40}(a|to)\s+https?://", "Pide enviar datos a una URL externa"),
]
_COMPILED = [(re.compile(p, re.IGNORECASE), why) for p, why in INJECTION_PATTERNS]


def scan_for_injection(text: str, source: str) -> list[dict]:
    flags = []
    for rx, why in _COMPILED:
        for m in rx.finditer(text):
            start = max(0, m.start() - 60)
            snippet = text[start : m.end() + 60].replace("\n", " ")
            flags.append({"source": source, "reason": why, "snippet": snippet.strip()})
            break
    return flags


# --------------------------------------------------------------------------- #
# Fórmulas seguras
# --------------------------------------------------------------------------- #
FORBIDDEN_FORMULA = re.compile(
    r"(WEBSERVICE|FILTERXML|CALL\s*\(|REGISTER(\.ID)?\s*\(|EXEC\s*\(|RTD\s*\(|IMPORTDATA|IMPORTXML|IMPORTHTML|IMPORTRANGE|\bcmd\s*\||\|\s*'|DDE)",
    re.IGNORECASE,
)


def check_formula(formula: str) -> str | None:
    """Devuelve un motivo de rechazo o None si la fórmula es aceptable."""
    if len(formula) > 2000:
        return "fórmula demasiado larga"
    if FORBIDDEN_FORMULA.search(formula):
        return "usa funciones externas o peligrosas (no permitidas)"
    if re.search(r"\[[^\]]*\.(xlsx|xls|xlsm|csv)\]", formula, re.IGNORECASE) or re.search(r"https?://", formula):
        return "hace referencia a libros o recursos externos"
    return None
