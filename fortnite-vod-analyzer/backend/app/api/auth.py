from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..security import current_user, hash_password, issue_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=8, max_length=200)
    display_name: str | None = Field(default=None, max_length=120)


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "display_name": u.display_name}


@router.get("/config")
def auth_config():
    s = get_settings()
    return {"mode": s.auth_mode, "allow_registration": s.allow_registration and s.auth_mode == "local"}


@router.post("/register")
def register(body: Credentials, db: Session = Depends(get_db)):
    s = get_settings()
    if s.auth_mode != "local":
        raise HTTPException(400, "El registro se gestiona con Supabase Auth")
    if not s.allow_registration and db.scalar(select(func.count(User.id))) > 0:
        raise HTTPException(403, "El registro está desactivado")
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "Email no válido")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    u = User(email=email, display_name=(body.display_name or email.split("@")[0]).strip(), password_hash=hash_password(body.password))
    db.add(u)
    db.commit()
    return {"token": issue_token(u), "user": _user_out(u)}


class Login(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: Login, db: Session = Depends(get_db)):
    if get_settings().auth_mode != "local":
        raise HTTPException(400, "Inicia sesión con Supabase Auth")
    u = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    return {"token": issue_token(u), "user": _user_out(u)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return _user_out(user)
