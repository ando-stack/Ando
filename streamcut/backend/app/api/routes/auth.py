from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import COOKIE, Principal, audit, current_principal, login_rate_limit
from app.core.config import get_settings
from app.core.security import hash_password, make_session_token, verify_password
from app.db.models import Setting, User, Workspace
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class SetupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    display_name: str = Field(min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=200)


def _set_cookie(resp: Response, user: User) -> None:
    s = get_settings()
    resp.set_cookie(COOKIE, make_session_token(str(user.id), user.session_version), max_age=s.session_max_age,
                    httponly=True, samesite="lax", secure=s.cookie_secure, path="/")


def _me(p: Principal) -> dict:
    return {"id": str(p.user.id), "email": p.user.email, "display_name": p.user.display_name,
            "workspace": {"id": str(p.workspace.id), "name": p.workspace.name,
                          "storage_quota_bytes": p.workspace.storage_quota_bytes}}


@router.get("/state")
def state(db: Session = Depends(get_db)):
    return {"needs_setup": (db.scalar(select(func.count(User.id))) or 0) == 0}


@router.post("/setup", dependencies=[Depends(login_rate_limit)])
def setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if db.scalar(select(func.count(User.id))):
        raise HTTPException(409, "La aplicación ya está configurada")
    user = User(email=body.email.lower(), display_name=body.display_name, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    ws = Workspace(name=f"Workspace de {body.display_name}", owner_id=user.id,
                   storage_quota_bytes=get_settings().default_quota_bytes)
    db.add(ws)
    db.flush()
    db.add(Setting(workspace_id=ws.id, data={}))
    db.commit()
    _set_cookie(response, user)
    p = Principal(user, ws)
    audit(db, p, "auth.setup", request=request)
    return _me(p)


@router.post("/login", dependencies=[Depends(login_rate_limit)])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not user.is_active or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Email o contraseña incorrectos")
    _set_cookie(response, user)
    ws = db.scalar(select(Workspace).where(Workspace.owner_id == user.id).order_by(Workspace.created_at))
    p = Principal(user, ws)
    audit(db, p, "auth.login", request=request)
    return _me(p)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/logout-all")
def logout_all(response: Response, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, p.user.id)
    user.session_version += 1
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/password")
def change_password(body: PasswordIn, request: Request, response: Response,
                    p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, p.user.id)
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "La contraseña actual no es correcta")
    user.password_hash = hash_password(body.new_password)
    user.session_version += 1
    db.commit()
    _set_cookie(response, user)
    audit(db, p, "auth.password_changed", request=request)
    return {"ok": True}


@router.get("/me")
def me(p: Principal = Depends(current_principal)):
    return _me(p)
