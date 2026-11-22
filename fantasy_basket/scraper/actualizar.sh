#!/usr/bin/env bash
# Actualiza ../data.json con las actas publicadas. Las fotos no se tocan: se mantienen las de ../fotos.
# Uso: ./actualizar.sh [idGrupo]
set -euo pipefail
cd "$(dirname "$0")"
cp ../data.json data_anterior.json
node crawl.js "${1:-629}"
python3 build.py
python3 price.py
python3 mantener_fotos.py data_anterior.json
python3 -c "import json;m=json.load(open('../data.json'))['meta'];print('Jornadas con actas:',m['rounds'],'· última acta:',m['updated'])"
