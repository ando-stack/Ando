#!/usr/bin/env bash
# Arranca el Estudio de Capas en http://127.0.0.1:8000
#   scripts/iniciar.sh         motor + editor compilado
#   scripts/iniciar.sh --dev   motor + editor en modo desarrollo (http://127.0.0.1:5173)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo "Falta la instalación. Ejecuta primero: python3 scripts/instalar.py"
  exit 1
fi
if [ "${1:-}" = "--dev" ]; then
  .venv/bin/python -m engine.server &
  MOTOR=$!
  trap 'kill $MOTOR 2>/dev/null' EXIT
  cd web && npx vite
else
  if [ ! -f web/dist/index.html ]; then
    echo "El editor no está compilado: cd web && npm install && npm run build"
    exit 1
  fi
  exec .venv/bin/python -m engine.server
fi
