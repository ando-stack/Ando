#!/usr/bin/env bash
# Actualiza data.json y fotos/ con las actas publicadas. Uso: ./actualizar.sh [idGrupo]
set -euo pipefail
cd "$(dirname "$0")"
node crawl.js "${1:-629}"
python3 build.py
python3 price.py
python3 fotos.py
python3 -c "import json;m=json.load(open('../data.json'))['meta'];print('Jornadas con actas:',m['rounds'],'· última acta:',m['updated'])"
