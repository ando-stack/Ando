@echo off
cd /d "%~dp0"
python actualizar_datos.py
echo Abre http://localhost:8000 en el navegador (Ctrl+C para cerrar)
start "" http://localhost:8000
cd web
python -m http.server 8000
