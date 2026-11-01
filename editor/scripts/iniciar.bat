@echo off
REM Arranca el Estudio de Capas en http://127.0.0.1:8000
cd /d "%~dp0\.."
if not exist ".venv\Scripts\python.exe" (
  echo Falta la instalacion. Ejecuta primero: python scripts\instalar.py
  pause
  exit /b 1
)
if not exist "web\dist\index.html" (
  echo El editor no esta compilado: compilandolo ahora ^(solo la primera vez^)...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo No se encuentra npm. Instala Node.js LTS desde https://nodejs.org y vuelve a abrir la terminal.
    pause
    exit /b 1
  )
  pushd web
  call npm install
  if errorlevel 1 (
    popd
    echo Fallo "npm install". Revisa el mensaje de arriba.
    pause
    exit /b 1
  )
  call npm run build
  if errorlevel 1 (
    popd
    echo Fallo "npm run build". Revisa el mensaje de arriba.
    pause
    exit /b 1
  )
  popd
)
echo Arrancando el motor (la primera vez puede tardar hasta un minuto)...
echo El navegador se abrira solo cuando este listo. No cierres esta ventana mientras uses el editor.
set ESTUDIO_ABRIR_NAVEGADOR=1
".venv\Scripts\python.exe" -m engine.server
