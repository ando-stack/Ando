"""Authentication.

* ``AUTH_MODE=local``: built-in accounts (scrypt password hashes + HS256 JWT).
* ``AUTH_MODE=supabase``: the browser signs in with Supabase Auth and sends the
  access token; we verify it (JWKS for asymmetric keys, or the legacy HS256
  secret) and map ``sub`` to a local user row.

Media streaming uses short-lived, single-purpose signed tokens because a
<video> element cannot send an Authorization header.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import os

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

_jwks_client = None


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_b64, dig_b64 = stored.split("$")
    salt = base64.b64decode(salt_b64)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return hmac.compare_digest(digest, base64.b64decode(dig_b64))


def issue_token(user: User, *, hours: int = 72) -> str:
    s = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode(
        {"sub": user.id, "email": user.email, "typ": "access", "iat": now, "exp": now + dt.timedelta(hours=hours)},
        s.app_secret,
        algorithm="HS256",
    )


def issue_media_token(owner_id: str, media_id: str, *, seconds: int = 6 * 3600) -> str:
    s = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode(
        {"sub": owner_id, "mid": media_id, "typ": "media", "exp": now + dt.timedelta(seconds=seconds)},
        s.app_secret,
        algorithm="HS256",
    )


def verify_media_token(token: str, media_id: str) -> str:
    try:
        data = jwt.decode(token, get_settings().app_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token de medio inválido o caducado")
    if data.get("typ") != "media" or data.get("mid") != media_id:
        raise HTTPException(403, "Token no válido para este archivo")
    return data["sub"]


def _supabase_claims(token: str) -> dict:
    global _jwks_client
    s = get_settings()
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "HS256")
    if alg == "HS256":
        if not s.supabase_jwt_secret:
            raise HTTPException(401, "SUPABASE_JWT_SECRET no configurado")
        return jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
    if not s.supabase_url:
        raise HTTPException(401, "SUPABASE_URL no configurado")
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(s.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json")
    key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(token, key.key, algorithms=[alg], audience="authenticated")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "No autenticado")
    token = auth[7:].strip()
    s = get_settings()
    try:
        if s.auth_mode == "supabase":
            claims = _supabase_claims(token)
            user = db.scalar(select(User).where(User.external_id == claims["sub"]))
            if not user:
                email = claims.get("email") or f"{claims['sub']}@supabase.local"
                user = db.scalar(select(User).where(User.email == email))
                if user:
                    user.external_id = claims["sub"]
                else:
                    user = User(email=email, external_id=claims["sub"], display_name=email.split("@")[0])
                    db.add(user)
                db.commit()
            return user
        claims = jwt.decode(token, s.app_secret, algorithms=["HS256"])
        if claims.get("typ") != "access":
            raise HTTPException(401, "Token inválido")
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesión caducada o token inválido")
    user = db.get(User, claims["sub"])
    if not user:
        raise HTTPException(401, "Usuario no encontrado")
    return user
