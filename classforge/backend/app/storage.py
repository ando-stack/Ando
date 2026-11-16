"""Almacenamiento de trabajos en disco.

Cada trabajo vive en ``data/jobs/<job_id>/`` con:
  - job.json      metadatos y estado
  - inputs/       archivos subidos (renombrados con id seguro)
  - outputs/vN/   archivos generados por versión
  - ingest.json   extracción de la etapa 1
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .config import settings

JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_job_id() -> str:
    # 192 bits de entropía: imposible de adivinar
    return secrets.token_urlsafe(24)


def new_file_id() -> str:
    return secrets.token_urlsafe(9)


def _lock(job_id: str) -> threading.RLock:
    with _locks_guard:
        if job_id not in _locks:
            _locks[job_id] = threading.RLock()
        return _locks[job_id]


def job_dir(job_id: str) -> Path:
    if not JOB_ID_RE.match(job_id or ""):
        raise ValueError("Identificador de trabajo no válido")
    d = (settings.jobs_dir / job_id).resolve()
    if settings.jobs_dir.resolve() not in d.parents:
        raise ValueError("Ruta no permitida")
    return d


def create_job(data: dict[str, Any]) -> dict[str, Any]:
    job_id = new_job_id()
    d = job_dir(job_id)
    (d / "inputs").mkdir(parents=True, exist_ok=False)
    (d / "outputs").mkdir()
    job = {
        "id": job_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_ts": time.time(),
        "status": "uploaded",
        "stage": "ingest",
        "progress": [],
        "error": None,
        "files": [],
        "analysis": None,
        "plan": None,
        "versions": [],
        "warnings": [],
        "security_flags": [],
        **data,
    }
    save_job(job)
    return job


def save_job(job: dict[str, Any]) -> None:
    d = job_dir(job["id"])
    with _lock(job["id"]):
        job["updated_at"] = now_iso()
        tmp = d / "job.json.tmp"
        tmp.write_text(json.dumps(job, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        os.replace(tmp, d / "job.json")


def load_job(job_id: str) -> dict[str, Any] | None:
    try:
        p = job_dir(job_id) / "job.json"
    except ValueError:
        return None
    if not p.exists():
        return None
    with _lock(job_id):
        return json.loads(p.read_text(encoding="utf-8"))


def update_job(job_id: str, fn: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    with _lock(job_id):
        job = load_job(job_id)
        if job is None:
            raise KeyError(job_id)
        fn(job)
        save_job(job)
        return job


def write_json(job_id: str, name: str, data: Any) -> None:
    p = job_dir(job_id) / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def read_json(job_id: str, name: str) -> Any:
    p = job_dir(job_id) / name
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def list_jobs() -> list[dict[str, Any]]:
    out = []
    if not settings.jobs_dir.exists():
        return out
    for d in settings.jobs_dir.iterdir():
        p = d / "job.json"
        if p.exists():
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
    return out


def delete_job(job_id: str) -> None:
    d = job_dir(job_id)
    with _lock(job_id):
        shutil.rmtree(d, ignore_errors=True)
    with _locks_guard:
        _locks.pop(job_id, None)


def cleanup_expired(max_age_hours: int | None = None) -> int:
    """Borra trabajos más antiguos que el periodo de retención. Devuelve cuántos borró."""
    hours = settings.retention_hours if max_age_hours is None else max_age_hours
    limit = time.time() - hours * 3600
    removed = 0
    if not settings.jobs_dir.exists():
        return 0
    for d in list(settings.jobs_dir.iterdir()):
        p = d / "job.json"
        try:
            ts = json.loads(p.read_text(encoding="utf-8")).get("created_ts", 0) if p.exists() else d.stat().st_mtime
        except (OSError, json.JSONDecodeError):
            ts = d.stat().st_mtime
        if ts < limit:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")


def safe_filename(name: str, default: str = "archivo") -> str:
    """Nombre de archivo seguro y legible: sin rutas y sin tildes ni caracteres raros
    (Práctica 2.docx → Practica_2.docx), para que funcione en cualquier sistema y plataforma de entrega."""
    name = os.path.basename((name or "").replace("\\", "/"))
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = SAFE_NAME_RE.sub("_", name).strip(" ._")
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"_+", "_", name)
    if not name:
        name = default
    stem, dot, ext = name.rpartition(".")
    if dot and len(stem) > 90:
        name = stem[:90] + "." + ext
    elif not dot and len(name) > 100:
        name = name[:100]
    return name
