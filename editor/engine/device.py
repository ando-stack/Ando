"""Detección automática del dispositivo de cálculo: CUDA (NVIDIA) > MPS (Apple Silicon) > CPU."""
from __future__ import annotations

import logging
import os
from functools import lru_cache

log = logging.getLogger("estudio")


@lru_cache(maxsize=1)
def dispositivo() -> str:
    forzado = os.environ.get("ESTUDIO_DISPOSITIVO", "").strip().lower()
    import torch

    if forzado in {"cpu", "cuda", "mps"}:
        return forzado
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    hilos = os.cpu_count() or 4
    torch.set_num_threads(max(1, hilos))
    return "cpu"


def proveedores_onnx() -> list[str]:
    """Proveedores de onnxruntime en orden de preferencia (solo los instalados)."""
    import onnxruntime as ort

    disponibles = ort.get_available_providers()
    preferidos = []
    if dispositivo() == "cuda":
        preferidos.append("CUDAExecutionProvider")
    if dispositivo() == "mps":
        preferidos.append("CoreMLExecutionProvider")
    preferidos.append("CPUExecutionProvider")
    return [p for p in preferidos if p in disponibles]


def es_falta_de_memoria(e: BaseException) -> bool:
    texto = str(e).lower()
    return isinstance(e, MemoryError) or "out of memory" in texto or "outofmemory" in type(e).__name__.lower()


def liberar_memoria() -> None:
    import gc

    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        try:
            torch.mps.empty_cache()
        except Exception:  # pragma: no cover
            pass


def info() -> dict:
    import torch

    d = dispositivo()
    nombre = "CPU"
    if d == "cuda":
        nombre = torch.cuda.get_device_name(0)
    elif d == "mps":
        nombre = "Apple Silicon (MPS)"
    return {"dispositivo": d, "nombre": nombre, "torch": torch.__version__, "hilos_cpu": os.cpu_count()}
