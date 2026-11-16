"""Almacenamiento de ficheros: local o compatible con S3 (MinIO, AWS, R2…).

Estructura de claves:
  ws/<workspace>/originals/<asset>/<nombre>      originales inmutables
  ws/<workspace>/derived/<asset>/<fichero>       proxies, audio, miniaturas, waveforms
  ws/<workspace>/renders/<clip>/<version>.mp4    clips renderizados
  tmp/…                                          temporales controlados (limpieza automática)
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Protocol

from app.core.config import get_settings


class Storage(Protocol):
    def put_file(self, local_path: Path, key: str, mime: str | None = None) -> int: ...
    def append(self, key: str, data: BinaryIO, offset: int) -> int: ...
    def size(self, key: str) -> int: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...
    def delete_prefix(self, prefix: str) -> None: ...
    def local_path(self, key: str) -> Path | None: ...
    def presigned_url(self, key: str, expires: int = 3600) -> str | None: ...
    @contextmanager
    def as_local(self, key: str) -> Iterator[Path]: ...


def sha256_file(path: Path, chunk: int = 4 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def safe_key(key: str) -> str:
    parts = [p for p in key.replace("\\", "/").split("/") if p not in ("", ".", "..")]
    if not parts:
        raise ValueError("Clave de almacenamiento vacía")
    return "/".join(parts)


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / safe_key(key)).resolve()
        if self.root not in p.parents:
            raise ValueError("Ruta fuera del almacenamiento")
        return p

    def put_file(self, local_path: Path, key: str, mime: str | None = None) -> int:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if Path(local_path).resolve() != dest:
            tmp = dest.with_suffix(dest.suffix + ".part")
            shutil.copyfile(local_path, tmp)
            os.replace(tmp, dest)
        return dest.stat().st_size

    def append(self, key: str, data: BinaryIO, offset: int) -> int:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        current = dest.stat().st_size if dest.exists() else 0
        if current != offset:
            raise ValueError(f"Offset incorrecto: esperado {current}, recibido {offset}")
        with open(dest, "ab") as f:
            shutil.copyfileobj(data, f, 1024 * 1024)
        return dest.stat().st_size

    def size(self, key: str) -> int:
        p = self._path(key)
        return p.stat().st_size if p.exists() else 0

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    def delete_prefix(self, prefix: str) -> None:
        p = self._path(prefix)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            p.unlink()

    def local_path(self, key: str) -> Path | None:
        return self._path(key)

    def presigned_url(self, key: str, expires: int = 3600) -> str | None:
        return None

    @contextmanager
    def as_local(self, key: str) -> Iterator[Path]:
        yield self._path(key)


class S3Storage:
    """Almacenamiento S3. Los workers descargan a una caché local para trabajar con FFmpeg."""

    def __init__(self) -> None:
        import boto3

        s = get_settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3", endpoint_url=s.s3_endpoint_url or None, region_name=s.s3_region,
            aws_access_key_id=s.s3_access_key or None, aws_secret_access_key=s.s3_secret_key or None)
        self.cache = s.data_dir / "s3cache"
        self.cache.mkdir(parents=True, exist_ok=True)
        # Las subidas por trozos se ensamblan en local y se suben al completarse.
        self.staging = LocalStorage(s.data_dir / "staging")

    def put_file(self, local_path: Path, key: str, mime: str | None = None) -> int:
        extra = {"ContentType": mime} if mime else None
        self.client.upload_file(str(local_path), self.bucket, safe_key(key), ExtraArgs=extra)
        return Path(local_path).stat().st_size

    def append(self, key: str, data: BinaryIO, offset: int) -> int:
        return self.staging.append(key, data, offset)

    def size(self, key: str) -> int:
        if key.startswith("tmp/"):
            return self.staging.size(key)
        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=safe_key(key))["ContentLength"])
        except Exception:
            return 0

    def exists(self, key: str) -> bool:
        if key.startswith("tmp/"):
            return self.staging.exists(key)
        return self.size(key) > 0

    def delete(self, key: str) -> None:
        if key.startswith("tmp/"):
            return self.staging.delete(key)
        self.client.delete_object(Bucket=self.bucket, Key=safe_key(key))

    def delete_prefix(self, prefix: str) -> None:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=safe_key(prefix)):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": objs})

    def local_path(self, key: str) -> Path | None:
        if key.startswith("tmp/"):
            return self.staging.local_path(key)
        return None

    def presigned_url(self, key: str, expires: int = 3600) -> str | None:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket,
                                                                         "Key": safe_key(key)},
                                                  ExpiresIn=expires)

    @contextmanager
    def as_local(self, key: str) -> Iterator[Path]:
        if key.startswith("tmp/"):
            with self.staging.as_local(key) as p:
                yield p
            return
        target = self.cache / safe_key(key)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".part")
            self.client.download_file(self.bucket, safe_key(key), str(tmp))
            os.replace(tmp, target)
        os.utime(target)
        yield target


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage() if s.storage_backend == "s3" else LocalStorage(s.data_dir / "media")
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None


@contextmanager
def temp_dir(prefix: str = "job") -> Iterator[Path]:
    """Directorio temporal controlado dentro de data/tmp (se limpia siempre)."""
    base = get_settings().data_dir / "tmp"
    base.mkdir(parents=True, exist_ok=True)
    d = Path(tempfile.mkdtemp(prefix=f"{prefix}-", dir=base))
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


def cleanup_temp(max_age_hours: int | None = None) -> int:
    s = get_settings()
    max_age = (max_age_hours or s.temp_max_age_hours) * 3600
    removed = 0
    for base in (s.data_dir / "tmp", s.data_dir / "s3cache"):
        if not base.exists():
            continue
        now = time.time()
        for entry in base.iterdir():
            try:
                if now - entry.stat().st_mtime > max_age:
                    if entry.is_dir():
                        shutil.rmtree(entry, ignore_errors=True)
                    else:
                        entry.unlink()
                    removed += 1
            except OSError:
                continue
    return removed
