#!/usr/bin/env bash
# Editor de vídeo con IA — instalación (la primera vez) y arranque. Uso: ./iniciar_editor.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
$PY backend/check_env.py
if [ ! -d .venv ]; then
  echo "Creando entorno de Python…"
  $PY -m venv .venv
fi
. .venv/bin/activate
pip install -q -r backend/requirements.txt
if [ ! -d frontend/node_modules ]; then
  echo "Instalando dependencias del frontend…"
  (cd frontend && npm install)
fi
echo "Compilando la interfaz…"
(cd frontend && npx vite build >/dev/null)
[ -f .env ] || cp .env.example .env
echo ""
echo "Abre http://127.0.0.1:8000 en el navegador (Ctrl+C para salir)"
cd backend && exec python main.py
