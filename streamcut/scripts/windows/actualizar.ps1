# STREAMCUT AI - actualizar a la ultima version sin perder .env, datos ni dependencias instaladas.
# 1) Descarga el ZIP nuevo de GitHub en tu carpeta Descargas.
# 2) Ejecuta: powershell -ExecutionPolicy Bypass -File scripts\windows\actualizar.ps1
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$zip = Get-ChildItem "$HOME\Downloads" -Filter "Ando-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { Write-Host "No encuentro el ZIP en Descargas (Ando-....zip)." -ForegroundColor Red; exit 1 }
Write-Host "Actualizando desde $($zip.Name)" -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP ("streamcut-update-" + [guid]::NewGuid())
Expand-Archive $zip.FullName -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "streamcut" }
# Copia el codigo nuevo; conserva .env, datos, entornos y compilaciones locales
robocopy $src $root /E /XD .venv node_modules .next data /XF .env /NFL /NDL /NJH /NJS | Out-Null
Remove-Item $tmp -Recurse -Force

# Para el programa si esta abierto
Get-NetTCPConnection -LocalPort 8000,3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Set-Location "$root\backend"
.\.venv\Scripts\pip install -q -r requirements.txt
$envFile = Get-Content "$root\.env" -ErrorAction SilentlyContinue
if ($envFile -match '^STREAMCUT_DATABASE_URL=sqlite') {
  $env:STREAMCUT_DATABASE_URL = "sqlite:///$($root -replace '\\','/')/data/streamcut.db"
}
.\.venv\Scripts\alembic upgrade head

Set-Location "$root\frontend"
npm ci
Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue
npm run build
Write-Host "Actualizacion completada. Arranca el programa como siempre." -ForegroundColor Green
