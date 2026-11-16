"""Contraseñas, sesiones firmadas y cifrado de secretos en reposo."""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import get_settings

log = logging.getLogger(__name__)
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def _key_file(name: str) -> Path:
    s = get_settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s.data_dir / name


def _persistent_secret(value: str, filename: str, generator) -> str:
    """Usa la variable de entorno; en desarrollo genera una clave local una única vez."""
    if value:
        return value
    s = get_settings()
    if s.env == "production":
        raise RuntimeError(f"Falta la variable STREAMCUT_{filename.upper().replace('.KEY', '')} en producción")
    path = _key_file(filename)
    if path.exists():
        return path.read_text().strip()
    new = generator()
    path.write_text(new)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    log.warning("Generada clave local de desarrollo en %s", path)
    return new


def secret_key() -> str:
    return _persistent_secret(get_settings().secret_key, "secret_key", lambda: secrets.token_urlsafe(48))


def _fernet() -> Fernet:
    raw = _persistent_secret(get_settings().encryption_key, "encryption_key",
                             lambda: Fernet.generate_key().decode())
    try:
        return Fernet(raw.encode())
    except ValueError:
        # Admite cualquier cadena: se deriva una clave Fernet válida.
        return Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()))


def encrypt(value: str | None) -> str | None:
    if value is None:
        return None
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        log.error("No se pudo descifrar un secreto (¿cambió STREAMCUT_ENCRYPTION_KEY?)")
        return None


def _serializer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret_key(), salt=salt)


def make_session_token(user_id: str, session_version: int) -> str:
    return _serializer("session").dumps({"u": user_id, "v": session_version})


def read_session_token(token: str) -> dict | None:
    try:
        return _serializer("session").loads(token, max_age=get_settings().session_max_age)
    except (BadSignature, SignatureExpired):
        return None


def sign_state(data: dict) -> str:
    return _serializer("oauth-state").dumps(data)


def read_state(token: str, max_age: int = 900) -> dict | None:
    try:
        return _serializer("oauth-state").loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None
