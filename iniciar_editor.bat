@echo off
REM Editor de video con IA - instalacion (la primera vez) y arranque
cd /d "%~dp0"

REM Se prefiere Python 3.12 / 3.11 / 3.13: algunas librerias (transcripcion, caras)
REM pueden no tener todavia version para Python 3.14 en Windows.
set "PY="
for %%V in (3.12 3.11 3.13) do (
  if not defined PY (
    py -%%V --version >nul 2>&1 && set "PY=py -%%V"
  )
)
if not defined PY set "PY=python"
echo Usando: %PY%

%PY% backend\check_env.py || (pause & exit /b 1)
if not exist .venv (
  echo Creando entorno de Python...
  %PY% -m venv .venv || (echo No se pudo crear el entorno de Python & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r backend\requirements.txt || (echo Fallo al instalar las librerias de Python & pause & exit /b 1)
if not exist frontend\node_modules (
  echo Instalando dependencias del frontend...
  pushd frontend
  call npm install || (popd & echo Fallo npm install & pause & exit /b 1)
  popd
)
echo Compilando la interfaz...
pushd frontend
call npx vite build || (popd & echo Fallo al compilar la interfaz & pause & exit /b 1)
popd
if not exist .env copy .env.example .env >nul
echo.
echo ============================================================
echo   Abre http://127.0.0.1:8000 en el navegador
echo   No cierres esta ventana mientras uses el editor
echo ============================================================
cd backend
python main.py
pause
