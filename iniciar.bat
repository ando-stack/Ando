@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (
  echo Necesitas Python 3.10 o superior: https://www.python.org/downloads/
  echo Marca la casilla "Add Python to PATH" al instalarlo.
  pause
  exit /b 1
)
if not exist .venv (
  echo Preparando AutoClips por primera vez, espera un momento...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt
python -m pip install -q --upgrade "yt-dlp[default]"
python app.py %*
pause
