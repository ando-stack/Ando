from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import analyses, auth, dashboard, matches, media, players, uploads
from .config import get_settings
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app() -> FastAPI:
    s = get_settings()
    init_db()
    app = FastAPI(title="Fortnite VOD Analyzer API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o for o in s.cors_origins if o],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    for r in (auth.router, players.router, matches.router, uploads.router, media.router, analyses.router, dashboard.router):
        app.include_router(r)

    @app.get("/health")
    def health():
        return {"ok": True}

    if s.embedded_worker:
        from .worker import start_embedded

        @app.on_event("startup")
        def _start_worker():  # pragma: no cover
            start_embedded()

    return app


app = create_app()
