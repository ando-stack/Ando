@echo off
REM Arranca GTA VI Shorts Factory y abre el panel en el navegador.
cd /d "%~dp0"
title ViceScope - Shorts Factory (no cierres esta ventana)
start "" cmd /c "timeout /t 8 >nul & start http://127.0.0.1:4317"
call npm start
pause
