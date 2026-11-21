"""File storage: local disk or any S3-compatible service (Supabase Storage, MinIO, AWS).

Keys are always generated server-side (``owner/match/uuid.ext``); user-supplied
filenames are never used as paths, so path traversal is impossible.
"""
from __future__ import annotations

import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path

from .config import get_settings


class Storage(ABC):
    @abstractmethod
    def put_file(self, local_path: Path, key: str, content_type: str | None = None) -> None: ...

    @abstractmethod
    def local_path(self, key: str) -> Path | None:
        """Path on disk if the object is local, else None."""

    @abstractmethod
    def download_to(self, key: str, dest: Path) -> Path: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None: ...

    def presigned_url(self, key: str, seconds: int = 3600) -> str | None:
        return None

    def read_bytes(self, key: str) -> bytes:
        p = self.local_path(key)
        if p:
            return p.read_bytes()
        tmp = get_settings().tmp_dir / ("dl-" + key.replace("/", "_"))
        self.download_to(key, tmp)
        try:
            return tmp.read_bytes()
        finally:
            tmp.unlink(missing_ok=True)


class LocalStorage(Storage):
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("invalid storage key")
        return p

    def put_file(self, local_path: Path, key: str, content_type: str | None = None) -> None:
        dest = self._p(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if local_path.resolve() != dest:
            shutil.move(str(local_path), dest)
        os.chmod(dest, 0o640)  # never executable

    def local_path(self, key: str) -> Path | None:
        p = self._p(key)
        return p if p.exists() else None

    def download_to(self, key: str, dest: Path) -> Path:
        shutil.copyfile(self._p(key), dest)
        return dest

    def delete(self, key: str) -> None:
        self._p(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        p = self._p(prefix)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)


class S3Storage(Storage):
    def __init__(self):
        import boto3

        s = get_settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint,
            region_name=s.s3_region,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key,
        )

    def put_file(self, local_path: Path, key: str, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else None
        self.client.upload_file(str(local_path), self.bucket, key, ExtraArgs=extra)
        local_path.unlink(missing_ok=True)

    def local_path(self, key: str) -> Path | None:
        return None

    def download_to(self, key: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(dest))
        return dest

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> None:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix.rstrip("/") + "/"):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": objs})

    def presigned_url(self, key: str, seconds: int = 3600) -> str | None:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=seconds
        )


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage() if s.storage_backend == "s3" else LocalStorage(s.data_dir / "storage")
    return _storage


def materialize(key: str, workdir: Path, name: str) -> Path:
    """Return a local path for ``key`` (downloading from S3 when needed)."""
    st = get_storage()
    p = st.local_path(key)
    if p:
        return p
    return st.download_to(key, workdir / name)
