#!/usr/bin/env bash
# Arranca backend (puerto 8000) y frontend (puerto 3000) para desarrollo.
set -e
cd "$(dirname "$0")"
if [ -f backend/.env ]; then set -a; . backend/.env; set +a; fi
(cd backend && python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT
cd frontend && [ -d node_modules ] || npm install
npm run dev
