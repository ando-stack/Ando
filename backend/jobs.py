"""Tareas largas en segundo plano con progreso visible y cancelación."""
from __future__ import annotations

import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from utils import Cancelled, new_id

_pool = ThreadPoolExecutor(max_workers=3)
_jobs: dict[str, "Job"] = {}
_lock = threading.Lock()


class Job:
    def __init__(self, kind: str, project: Optional[str], label: str):
        self.id = new_id("tarea")
        self.kind = kind
        self.project = project
        self.label = label
        self.status = "pendiente"      # pendiente | ejecutando | completada | error | cancelada
        self.progress = 0.0
        self.message = ""
        self.result: Any = None
        self.error: Optional[str] = None
        self.warnings: list[str] = []
        self.cancel_event = threading.Event()

    # para las funciones de trabajo
    def update(self, progress: Optional[float] = None, message: Optional[str] = None):
        if progress is not None:
            self.progress = max(0.0, min(1.0, progress))
        if message is not None:
            self.message = message
        self.check()

    def check(self):
        if self.cancel_event.is_set():
            raise Cancelled()

    def sub(self, start: float, end: float) -> Callable[[float], None]:
        """Devuelve un callback de progreso que mapea 0..1 al rango [start, end]."""
        return lambda p: self.update(start + (end - start) * p)

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "project": self.project, "label": self.label,
                "status": self.status, "progress": round(self.progress, 3), "message": self.message,
                "error": self.error, "warnings": self.warnings, "result": self.result}


def start(kind: str, project: Optional[str], label: str, fn: Callable[[Job], Any]) -> Job:
    job = Job(kind, project, label)
    with _lock:
        _jobs[job.id] = job

    def runner():
        job.status = "ejecutando"
        try:
            job.result = fn(job)
            job.progress = 1.0
            job.status = "completada"
            if not job.message:
                job.message = "Terminado"
        except Cancelled:
            job.status = "cancelada"
            job.message = "Cancelada por el usuario"
        except Exception as e:  # noqa: BLE001
            job.status = "error"
            job.error = str(e)
            job.message = "Error"
            traceback.print_exc()

    _pool.submit(runner)
    return job


def get(job_id: str) -> Optional[Job]:
    return _jobs.get(job_id)


def cancel(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if not job:
        return False
    job.cancel_event.set()
    return True


def list_jobs(project: Optional[str] = None) -> list[dict]:
    return [j.to_dict() for j in _jobs.values() if project is None or j.project == project]
