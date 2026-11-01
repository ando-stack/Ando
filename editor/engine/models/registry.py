"""Registro de modelos: qué se descarga, de dónde, con qué licencia y su suma de control.

Todas las descargas se verifican (SHA-256 o MD5 publicado por el proyecto original) y se
guardan en engine/models/weights. Ningún modelo ejecuta código remoto: los modelos de
Hugging Face usan arquitecturas incluidas en `transformers` o archivos ONNX.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

PESOS = Path(os.environ.get("ESTUDIO_PESOS", Path(__file__).resolve().parent / "weights"))
HF_HOME = PESOS / "hf"


@dataclass(frozen=True)
class Archivo:
    nombre: str  # ruta relativa dentro del repo HF o nombre local
    sha256: str | None = None
    md5: str | None = None


@dataclass(frozen=True)
class Modelo:
    clave: str
    tarea: str
    descripcion: str
    licencia: str
    uso_comercial: bool
    fuente: str
    tamano_mb: int
    # Hugging Face (repo + revisión fijada) o URL directa
    repo: str | None = None
    revision: str | None = None
    url: str | None = None
    archivos: tuple[Archivo, ...] = field(default_factory=tuple)
    opcional: bool = False


MODELOS: dict[str, Modelo] = {
    "birefnet": Modelo(
        clave="birefnet",
        tarea="Recorte de fondo de alta calidad (sujeto principal, pelo)",
        descripcion="BiRefNet (general) exportado a ONNX por onnx-community",
        licencia="MIT",
        uso_comercial=True,
        fuente="https://huggingface.co/onnx-community/BiRefNet-ONNX",
        tamano_mb=973,
        repo="onnx-community/BiRefNet-ONNX",
        revision="534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67",
        archivos=(Archivo("onnx/model.onnx"), Archivo("config.json")),
    ),
    "birefnet_lite": Modelo(
        clave="birefnet_lite",
        tarea="Recorte de fondo (versión ligera, equipos con poca memoria)",
        descripcion="BiRefNet_lite exportado a ONNX por onnx-community",
        licencia="MIT",
        uso_comercial=True,
        fuente="https://huggingface.co/onnx-community/BiRefNet_lite-ONNX",
        tamano_mb=224,
        repo="onnx-community/BiRefNet_lite-ONNX",
        revision="de15b22ba131738a16dff04aab8bdf8dc32e3ac1",
        archivos=(Archivo("onnx/model.onnx"), Archivo("config.json")),
        opcional=True,
    ),
    "sam2": Modelo(
        clave="sam2",
        tarea="Segmentación por clic/caja de sujetos y objetos",
        descripcion="SAM 2.1 Hiera-Small (Meta)",
        licencia="Apache-2.0",
        uso_comercial=True,
        fuente="https://huggingface.co/facebook/sam2.1-hiera-small",
        tamano_mb=184,
        repo="facebook/sam2.1-hiera-small",
        revision="ee5bba1d82bb8749febdf90f45e84b687142ba03",
        archivos=(
            Archivo("model.safetensors", sha256="0a4067b11ce1e23d5229203f11c718a823060d15a4b23fa2372a7d4b77cbbc60"),
            Archivo("config.json"),
            Archivo("preprocessor_config.json"),
            Archivo("processor_config.json"),
        ),
    ),
    "rtdetr": Modelo(
        clave="rtdetr",
        tarea="Detección de personas y objetos (80 clases COCO)",
        descripcion="RT-DETRv2 R18 (Baidu / PekingU)",
        licencia="Apache-2.0",
        uso_comercial=True,
        fuente="https://huggingface.co/PekingU/rtdetr_v2_r18vd",
        tamano_mb=81,
        repo="PekingU/rtdetr_v2_r18vd",
        revision="5650961749fa93567c0d46fc7f43ea4f9e914107",
        archivos=(
            Archivo("model.safetensors", sha256="d18309d0d7ea57048138885c4c6ecfcb1e24506fc6153b94ad484f8ab62c7115"),
            Archivo("config.json"),
            Archivo("preprocessor_config.json"),
        ),
    ),
    "vitmatte": Modelo(
        clave="vitmatte",
        tarea="Afinado de bordes difíciles (pelo) a partir de un trimapa",
        descripcion="ViTMatte-Small Composition-1k (HUST)",
        licencia="Apache-2.0",
        uso_comercial=True,
        fuente="https://huggingface.co/hustvl/vitmatte-small-composition-1k",
        tamano_mb=103,
        repo="hustvl/vitmatte-small-composition-1k",
        revision="6a58ad7646403c1df626fbd746900aec7361ea1d",
        archivos=(Archivo("model.safetensors"), Archivo("config.json"), Archivo("preprocessor_config.json")),
    ),
    "lama": Modelo(
        clave="lama",
        tarea="Relleno inteligente (inpainting) del fondo",
        descripcion="Big-LaMa (Samsung Research) en TorchScript, publicado por el proyecto IOPaint",
        licencia="Apache-2.0",
        uso_comercial=True,
        fuente="https://github.com/advimman/lama",
        tamano_mb=206,
        url="https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt",
        archivos=(
            Archivo(
                "big-lama.pt",
                sha256="344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9",
                md5="e3aa4aaa15225a33ec84f9f4bc47e500",
            ),
        ),
    ),
    "ocr_det": Modelo(
        clave="ocr_det",
        tarea="Detección de texto (cajas rotadas)",
        descripcion="PP-OCRv6 det medium (PaddleOCR) en ONNX, vía RapidOCR",
        licencia="Apache-2.0",
        uso_comercial=True,
        fuente="https://www.modelscope.cn/models/RapidAI/RapidOCR",
        tamano_mb=62,
        url="https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_medium.onnx",
        archivos=(Archivo("PP-OCRv6_det_medium.onnx", sha256="92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2"),),
    ),
    "ocr_rec": Modelo(
        clave="ocr_rec",
        tarea="Lectura de texto multilingüe (incluye español: á, é, ñ, ¿, ¡)",
        descripcion="PP-OCRv6 rec medium (PaddleOCR) en ONNX, vía RapidOCR",
        licencia="Apache-2.0",
        uso_comercial=True,
        fuente="https://www.modelscope.cn/models/RapidAI/RapidOCR",
        tamano_mb=77,
        url="https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx",
        archivos=(Archivo("PP-OCRv6_rec_medium.onnx", sha256="eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b"),),
    ),
}


def _hash(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    with open(path, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def verificar_archivo(path: Path, a: Archivo) -> bool:
    if not path.exists():
        return False
    if a.sha256 and _hash(path, "sha256") != a.sha256:
        return False
    if a.md5 and _hash(path, "md5") != a.md5:
        return False
    return True


def ruta_local(m: Modelo, nombre: str | None = None) -> Path:
    """Ruta del archivo principal (o del indicado) de un modelo."""
    nombre = nombre or m.archivos[0].nombre
    if m.repo:
        snap = HF_HOME / "hub" / f"models--{m.repo.replace('/', '--')}" / "snapshots" / m.revision
        return snap / nombre
    return PESOS / nombre


def disponible(clave: str) -> bool:
    m = MODELOS[clave]
    return all(ruta_local(m, a.nombre).exists() for a in m.archivos)


def _descargar_url(url: str, destino: Path, progreso: Callable[[str], None] | None) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destino.parent, delete=False) as tmp:
        with urllib.request.urlopen(url, timeout=120) as r:
            total = int(r.headers.get("Content-Length") or 0)
            leido = 0
            for bloque in iter(lambda: r.read(1 << 20), b""):
                tmp.write(bloque)
                leido += len(bloque)
                if progreso and total:
                    progreso(f"{destino.name}: {leido * 100 // total}%")
    shutil.move(tmp.name, destino)


def descargar(clave: str, progreso: Callable[[str], None] | None = None) -> Path:
    """Descarga un modelo (si falta) y verifica su integridad. Lanza RuntimeError si no cuadra."""
    m = MODELOS[clave]
    if m.repo:
        os.environ.setdefault("HF_HOME", str(HF_HOME))
        from huggingface_hub import hf_hub_download

        for a in m.archivos:
            p = ruta_local(m, a.nombre)
            if not p.exists():
                hf_hub_download(m.repo, a.nombre, revision=m.revision, cache_dir=str(HF_HOME / "hub"))
            # huggingface_hub ya verifica el SHA-256 de los archivos LFS; los fijados aquí se comprueban otra vez
            if (a.sha256 or a.md5) and not verificar_archivo(p, a):
                p.unlink(missing_ok=True)
                raise RuntimeError(f"Suma de control incorrecta en {m.repo}/{a.nombre}")
    else:
        a = m.archivos[0]
        p = ruta_local(m)
        if not verificar_archivo(p, a):
            _descargar_url(m.url, p, progreso)
            if not verificar_archivo(p, a):
                p.unlink(missing_ok=True)
                raise RuntimeError(f"Suma de control incorrecta en {m.url}")
    return ruta_local(m)


def estado() -> list[dict]:
    return [
        {
            "clave": m.clave,
            "tarea": m.tarea,
            "descripcion": m.descripcion,
            "licencia": m.licencia,
            "uso_comercial": m.uso_comercial,
            "fuente": m.fuente,
            "opcional": m.opcional,
            "disponible": disponible(m.clave),
        }
        for m in MODELOS.values()
    ]
