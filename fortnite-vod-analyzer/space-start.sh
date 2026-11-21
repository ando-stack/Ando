#!/usr/bin/env bash
# Arranque de un solo contenedor: API (127.0.0.1:8000), worker y web (puerto $PORT, sirve la API en /backend).
set -euo pipefail
export APP_SECRET="${APP_SECRET:-$(python -c 'import secrets; print(secrets.token_hex(32))')}"
cd /app/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
python -m app.worker &
cd /app/web
exec node server.js
