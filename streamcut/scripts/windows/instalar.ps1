# STREAMCUT AI — instalación nativa en Windows (sin Docker).
# Requisitos: Python 3.12 o 3.13, Node.js 22 LTS y FFmpeg en el PATH.
#   winget install Python.Python.3.12 OpenJS.NodeJS.LTS Gyan.FFmpeg
# Ejecuta desde la carpeta "streamcut":  powershell -ExecutionPolicy Bypass -File scripts\windows\instalar.ps1
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Falta '$cmd'. $hint" -ForegroundColor Red; exit 1 }
}
Need python "Instala Python 3.12: winget install Python.Python.3.12"
Need node   "Instala Node.js 22: winget install OpenJS.NodeJS.LTS"
Need ffmpeg "Instala FFmpeg: winget install Gyan.FFmpeg (y abre una terminal nueva)"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  # Modo de un solo proceso con SQLite y cola en memoria: no necesita PostgreSQL ni Redis.
  (Get-Content ".env") `
    -replace '^STREAMCUT_RUN_MODE=.*', 'STREAMCUT_RUN_MODE=all-in-one' `
    -replace '^STREAMCUT_BROKER=.*', 'STREAMCUT_BROKER=memory' `
    -replace '^STREAMCUT_DATABASE_URL=.*', 'STREAMCUT_DATABASE_URL=sqlite:///./data/streamcut.db' |
    Set-Content ".env" -Encoding ascii
  Write-Host "Creado .env (SQLite + modo all-in-one). Edítalo para añadir tus claves de Twitch/YouTube." -ForegroundColor Yellow
}
New-Item -ItemType Directory -Force -Path "data" | Out-Null

Write-Host "== Backend ==" -ForegroundColor Cyan
Set-Location "$root\backend"
if (-not (Test-Path ".venv")) { python -m venv .venv }
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\pip install -r requirements.txt
$env:STREAMCUT_DATABASE_URL = "sqlite:///$($root -replace '\\','/')/data/streamcut.db"
if ((Get-Content "$root\.env") -match '^STREAMCUT_DATABASE_URL=postgresql') { Remove-Item Env:STREAMCUT_DATABASE_URL }
.\.venv\Scripts\alembic upgrade head

Write-Host "== Frontend ==" -ForegroundColor Cyan
Set-Location "$root\frontend"
npm ci
npm run build
Write-Host "Instalación completada. Arranca con: scripts\windows\iniciar.ps1" -ForegroundColor Green
