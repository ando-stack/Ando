"""Dependencias comunes: autenticación por cookie de sesión, workspace, CSRF y rate limiting."""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import read_session_token
from app.db.models import AuditEvent, User, Workspace
from app.db.session import get_db

COOKIE = "sc_session"


@dataclass
class Principal:
    user: User
    workspace: Workspace

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    token = request.cookies.get(COOKIE)
    data = read_session_token(token) if token else None
    if not data:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No has iniciado sesión")
    user = db.get(User, uuid.UUID(data["u"]))
    if user is None or not user.is_active or user.session_version != data.get("v"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión no válida")
    ws = db.scalar(select(Workspace).where(Workspace.owner_id == user.id).order_by(Workspace.created_at))
    if ws is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Usuario sin workspace")
    return Principal(user, ws)


def audit(db: Session, p: Principal | None, action: str, target_type: str | None = None,
          target_id: object | None = None, request: Request | None = None, **data) -> None:
    db.add(AuditEvent(workspace_id=p.workspace_id if p else None, user_id=p.user.id if p else None, action=action,
                      target_type=target_type, target_id=str(target_id) if target_id else None,
                      ip=request.client.host if request and request.client else None, data=data))
    db.commit()


class RateLimiter:
    """Ventana deslizante en memoria por clave (IP o usuario). Suficiente para un despliegue de un nodo;
    detrás de varios nodos conviene un proxy con rate limiting."""

    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


limiter = RateLimiter()


def login_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "?"
    if not limiter.check(f"login:{ip}", get_settings().login_rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Espera un minuto.")
