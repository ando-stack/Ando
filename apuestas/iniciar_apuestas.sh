#!/usr/bin/env bash
# Actualiza los datos y abre Cuota Justa en http://localhost:8000
set -e
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Necesitas Python 3: https://www.python.org/downloads/"; exit 1; }
python3 actualizar_datos.py || echo "(No se pudieron actualizar los datos; uso los últimos guardados)"
echo "Abre http://localhost:8000 en el navegador (Ctrl+C para cerrar)"
( sleep 1; (xdg-open http://localhost:8000 || open http://localhost:8000) >/dev/null 2>&1 || true ) &
cd web && python3 -m http.server 8000
