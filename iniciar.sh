#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Necesitas Python 3.10 o superior: https://www.python.org/downloads/"; exit 1; }
if [ ! -d .venv ]; then
  echo "Preparando AutoClips por primera vez, espera un momento..."
  python3 -m venv .venv
fi
source .venv/bin/activate
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt
python -m pip install -q --upgrade "yt-dlp[default]"
python app.py "$@"
