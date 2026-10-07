"""Utilidades comunes: FFmpeg/ffprobe con registro de errores, ids y rutas."""
from __future__ import annotations

import json
import re
import shlex
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from config import PROJECTS_DIR


class Cancelled(Exception):
    pass


class FFmpegError(RuntimeError):
    def __init__(self, message: str, log_file: Optional[Path] = None):
        super().__init__(message)
        self.log_file = log_file


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\-]+", "-", name.strip().lower(), flags=re.UNICODE).strip("-")
    return s[:60] or "proyecto"


def project_dir(name: str) -> Path:
    p = (PROJECTS_DIR / name).resolve()
    if PROJECTS_DIR not in p.parents:
        raise ValueError("nombre de proyecto no válido")
    return p


def write_log(proj_dir: Optional[Path], label: str, cmd: list[str] | str, output: str) -> Optional[Path]:
    if proj_dir is None:
        return None
    logs = proj_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    f = logs / f"{stamp}-{slugify(label)}.log"
    cmd_s = cmd if isinstance(cmd, str) else shlex.join(cmd)
    f.write_text(f"COMANDO:\n{cmd_s}\n\nSALIDA:\n{output}\n", encoding="utf-8")
    return f


def run(cmd: list[str], proj_dir: Optional[Path] = None, label: str = "ffmpeg",
        duration: Optional[float] = None, progress: Optional[Callable[[float], None]] = None,
        cancel: Optional[threading.Event] = None, timeout: Optional[float] = None,
        cwd: Optional[Path] = None) -> str:
    """Ejecuta FFmpeg (u otro comando). Si falla, guarda comando y error en logs/ y lanza FFmpegError.

    Si se pasa `duration` y `progress`, añade -progress para informar del avance (0..1)."""
    cmd = list(cmd)
    use_progress = progress is not None and duration and cmd and Path(cmd[0]).name.startswith("ffmpeg")
    if use_progress:
        cmd = [cmd[0], "-progress", "pipe:2", "-nostats"] + cmd[1:]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace", cwd=cwd)
    err_lines: list[str] = []
    out_chunks: list[str] = []

    def read_out():
        out_chunks.append(proc.stdout.read())

    t = threading.Thread(target=read_out, daemon=True)
    t.start()
    start = time.time()
    for line in proc.stderr:
        err_lines.append(line)
        if len(err_lines) > 4000:
            del err_lines[:2000]
        if use_progress and line.startswith("out_time_ms="):
            try:
                v = int(line.split("=", 1)[1]) / 1e6
                progress(max(0.0, min(1.0, v / duration)))
            except ValueError:
                pass
        if cancel is not None and cancel.is_set():
            proc.kill()
            proc.wait()
            raise Cancelled()
        if timeout and time.time() - start > timeout:
            proc.kill()
            break
    proc.wait()
    t.join(timeout=5)
    if cancel is not None and cancel.is_set():
        raise Cancelled()
    if proc.returncode != 0:
        output = "".join(err_lines)
        log = write_log(proj_dir, label, cmd, output)
        tail = "\n".join(l for l in output.strip().splitlines()[-6:] if not l.startswith(("frame=", "out_time", "progress=")))
        try:
            shown = log.relative_to(PROJECTS_DIR) if log else None
        except ValueError:
            shown = log
        where = f" (detalles en {shown})" if log else ""
        raise FFmpegError(f"Falló {label}{where}: {tail[-500:]}", log)
    return "".join(out_chunks)


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise FFmpegError(f"ffprobe no puede leer {Path(path).name}: {out.stderr.strip()[-300:]}")
    return json.loads(out.stdout)


def now_iso() -> str:
    from datetime import timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fmt_time(t: float) -> str:
    t = max(0.0, t)
    m, s = divmod(t, 60)
    return f"{int(m):02d}:{s:04.1f}" if s % 1 else f"{int(m):02d}:{int(s):02d}"
