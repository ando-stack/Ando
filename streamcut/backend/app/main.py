"""Aplicación FastAPI de STREAMCUT AI."""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import limiter
from app.api.routes import (
    assets,
    auth,
    channels,
    clips,
    events,
    library,
    live,
    media,
    oauth,
    settings_routes,
    stats,
    templates_routes,
)
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.session import SessionLocal

log = logging.getLogger(__name__)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _start_embedded_workers() -> list:
    """Modo all-in-one: workers Dramatiq en hilos + monitor en un hilo con su propio bucle."""
    from dramatiq import Worker

    from app.live.monitor import Monitor
    from app.workers import tasks  # noqa: F401  (registra actores)
    from app.workers.broker import setup_broker

    broker = setup_broker()
    worker = Worker(broker, worker_threads=max(2, get_settings().worker_concurrency))
    worker.start()
    monitor = Monitor()

    def run_monitor() -> None:
        asyncio.run(monitor.run())

    t = threading.Thread(target=run_monitor, name="monitor", daemon=True)
    t.start()
    return [worker, monitor]


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    s = get_settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    from app.services.templates import ensure_builtin_templates
    try:
        with SessionLocal() as db:
            ensure_builtin_templates(db)
    except Exception as exc:  # p. ej. migraciones no aplicadas todavía
        log.error("No se pudieron preparar las plantillas: %s (¿ejecutaste 'alembic upgrade head'?)", exc)
    embedded = _start_embedded_workers() if s.run_mode == "all-in-one" else []
    yield
    for item in embedded:
        if hasattr(item, "stop"):
            item.stop()
        if hasattr(item, "shutdown"):
            item.shutdown()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="STREAMCUT AI", version="1.0.0", lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=s.allowed_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def security_middleware(request: Request, call_next):
        # CSRF: las peticiones que modifican estado deben venir de un origen permitido.
        if request.method not in SAFE_METHODS and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin") or request.headers.get("referer")
            if origin:
                o = urlparse(origin)
                base = f"{o.scheme}://{o.netloc}"
                same = o.netloc == request.headers.get("host")
                if not same and base not in s.allowed_origins:
                    return JSONResponse({"detail": "Origen no permitido"}, status_code=403)
        ip = request.client.host if request.client else "?"
        if request.url.path.startswith("/api/") and not request.url.path.startswith(("/api/events", "/api/media")):
            if not limiter.check(f"api:{ip}", s.rate_limit_per_minute):
                return JSONResponse({"detail": "Demasiadas peticiones"}, status_code=429)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    for r in (auth, channels, live, assets, clips, library, templates_routes, settings_routes, stats, events,
              media, oauth):
        app.include_router(r.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
