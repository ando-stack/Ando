@echo off
REM Arranca el Estudio de Capas en http://127.0.0.1:8000
cd /d "%~dp0\.."
if not exist ".venv\Scripts\python.exe" (
  echo Falta la instalacion. Ejecuta primero: python scripts\instalar.py
  pause
  exit /b 1
)
if not exist "web\dist\index.html" (
  echo El editor no esta compilado: cd web ^&^& npm install ^&^& npm run build
  pause
  exit /b 1
)
start "" http://127.0.0.1:8000
".venv\Scripts\python.exe" -m engine.server
