"""Configuración de pruebas.

- Base de datos: PostgreSQL de pruebas si STREAMCUT_TEST_DATABASE_URL está definida o accesible;
  si no, SQLite. El esquema se crea con las migraciones de Alembic (se prueban también).
- Broker en memoria y workers Dramatiq reales en hilos.
- Vídeos de prueba reales generados con FFmpeg (voz sintetizada, risa, cambio de escena).
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

TMP = Path(tempfile.mkdtemp(prefix="streamcut-tests-"))
FIXTURES = Path(os.environ.get("STREAMCUT_FIXTURES_DIR", Path(tempfile.gettempdir()) / "streamcut-fixtures"))


def _pick_db() -> str:
    url = os.environ.get("STREAMCUT_TEST_DATABASE_URL",
                         "postgresql+psycopg://streamcut:streamcut@localhost:5432/streamcut_test")
    if url.startswith("postgresql"):
        try:
            import psycopg
            psycopg.connect(url.replace("+psycopg", ""), connect_timeout=2).close()
            return url
        except Exception:
            pass
    return f"sqlite:///{TMP / 'test.db'}"


os.environ.update({
    "STREAMCUT_ENV": "test",
    "STREAMCUT_DATABASE_URL": _pick_db(),
    "STREAMCUT_BROKER": "memory",
    "STREAMCUT_DATA_DIR": str(TMP / "data"),
    "STREAMCUT_WHISPER_MODEL": os.environ.get("STREAMCUT_WHISPER_MODEL", "tiny"),
    "STREAMCUT_WHISPER_LIVE_MODEL": "tiny",
    "STREAMCUT_TWITCH_CLIENT_ID": "",
    "STREAMCUT_TWITCH_CLIENT_SECRET": "",
    "STREAMCUT_YOUTUBE_API_KEY": "",
    "STREAMCUT_RATE_LIMIT_PER_MINUTE": "100000",
    "STREAMCUT_LOGIN_RATE_LIMIT_PER_MINUTE": "1000",
    "STREAMCUT_LIVE_SEGMENT_SECONDS": "2",
})


def _reset_schema() -> None:
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from app.db.session import get_engine
    url = os.environ["STREAMCUT_DATABASE_URL"]
    eng = get_engine()
    if url.startswith("postgresql"):
        with eng.begin() as c:
            c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session", autouse=True)
def _schema():
    _reset_schema()
    from app.db.session import SessionLocal
    from app.services.templates import ensure_builtin_templates
    with SessionLocal() as db:
        ensure_builtin_templates(db)
    yield
    shutil.rmtree(TMP, ignore_errors=True)


@pytest.fixture(scope="session")
def worker():
    """Workers Dramatiq reales sobre el broker en memoria."""
    import dramatiq

    from app.workers import tasks  # noqa: F401
    from app.workers.broker import setup_broker
    broker = setup_broker()
    w = dramatiq.Worker(broker, worker_threads=2)
    w.start()

    class Helper:
        def drain(self, timeout: float = 900.0) -> None:
            """Espera a que no quede ningún mensaje pendiente en ninguna cola (incluidas las diferidas)."""
            import time
            deadline = time.monotonic() + timeout
            stable = 0
            while time.monotonic() < deadline:
                busy = any(q.unfinished_tasks for q in list(broker.queues.values()))
                stable = 0 if busy else stable + 1
                if stable >= 4:
                    return
                time.sleep(0.25)
            raise TimeoutError("Los workers no terminaron a tiempo")

    yield Helper()
    w.stop()


@pytest.fixture(scope="session")
def highlight_video() -> Path:
    from tests.fixtures import make_highlight_video
    return make_highlight_video(FIXTURES / "highlight.mp4")


@pytest.fixture(scope="session")
def silent_video() -> Path:
    from tests.fixtures import make_highlight_video
    return make_highlight_video(FIXTURES / "silent.mp4", duration=20.0, with_audio=False)


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import create_app
    with TestClient(create_app(), base_url="http://localhost") as c:
        yield c


@pytest.fixture()
def auth_client(client):
    """Cliente autenticado (crea el administrador la primera vez)."""
    r = client.get("/api/auth/state")
    if r.json()["needs_setup"]:
        r = client.post("/api/auth/setup", json={"email": "admin@example.com", "password": "contraseña-segura-1",
                                                 "display_name": "Admin"})
        assert r.status_code == 200, r.text
    else:
        r = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "contraseña-segura-1"})
        assert r.status_code == 200, r.text
    return client


def upload_file(client, path: Path, chunk: int = 512 * 1024, auto_analyze: bool = True, title: str | None = None):
    size = path.stat().st_size
    r = client.post("/api/uploads", json={"filename": path.name, "size": size, "title": title})
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    with open(path, "rb") as f:
        offset = 0
        while offset < size:
            data = f.read(chunk)
            r = client.put(f"/api/uploads/{uid}?offset={offset}", content=data,
                           headers={"Content-Type": "application/octet-stream"})
            assert r.status_code == 200, r.text
            offset = r.json()["offset"]
    r = client.post(f"/api/uploads/{uid}/complete", json={"auto_analyze": auto_analyze})
    assert r.status_code == 200, r.text
    return r.json()
