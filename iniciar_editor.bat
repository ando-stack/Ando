@echo off
REM Editor de video con IA - instalacion (la primera vez) y arranque
cd /d "%~dp0"
python backend\check_env.py || (pause & exit /b 1)
if not exist .venv (
  echo Creando entorno de Python...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -q -r backend\requirements.txt
if not exist frontend\node_modules (
  echo Instalando dependencias del frontend...
  pushd frontend & call npm install & popd
)
echo Compilando la interfaz...
pushd frontend & call npx vite build & popd
if not exist .env copy .env.example .env
echo.
echo Abre http://127.0.0.1:8000 en el navegador (Ctrl+C para salir)
cd backend
python main.py
