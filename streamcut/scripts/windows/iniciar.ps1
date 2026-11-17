# STREAMCUT AI - arranque en Windows.
# Abre el servidor y la web en dos ventanas (no las cierres mientras uses el programa)
# y, cuando todo esta listo, abre http://localhost:3000
#   -SinNavegador   no abre el navegador (para el arranque automatico con Windows)
param([switch]$SinNavegador)

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$envFile = Get-Content "$root\.env" -ErrorAction SilentlyContinue
$dbLine = ""
if ($envFile -match '^STREAMCUT_DATABASE_URL=sqlite') {
  $dbUrl = "sqlite:///$($root -replace '\\','/')/data/streamcut.db"
  $dbLine = "`$env:STREAMCUT_DATABASE_URL='$dbUrl'; "
}

# Cierra una copia anterior que se haya quedado abierta
Get-NetTCPConnection -LocalPort 8000,3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# Si la web no esta compilada, se compila una vez
if (-not (Test-Path "$root\frontend\.next\BUILD_ID")) {
  Write-Host "Compilando la web (solo la primera vez, 1-2 minutos)..." -ForegroundColor Cyan
  Push-Location "$root\frontend"; npm run build; Pop-Location
}

$backend = "$root\backend"
Start-Process powershell -WorkingDirectory $backend -ArgumentList @(
  "-NoExit", "-Command",
  "`$host.UI.RawUI.WindowTitle='STREAMCUT - servidor (no cerrar)'; $dbLine.\.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000")

if ($envFile -match '^STREAMCUT_RUN_MODE=api') {
  Start-Process powershell -WorkingDirectory $backend -ArgumentList @("-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle='STREAMCUT - workers'; $dbLine.\.venv\Scripts\dramatiq app.workers.tasks --processes 1 --threads 2")
  Start-Process powershell -WorkingDirectory $backend -ArgumentList @("-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle='STREAMCUT - monitor'; $dbLine.\.venv\Scripts\python -m app.live.monitor")
}

Start-Process powershell -WorkingDirectory "$root\frontend" -ArgumentList @(
  "-NoExit", "-Command",
  "`$host.UI.RawUI.WindowTitle='STREAMCUT - web (no cerrar)'; npx next start -p 3000")

Write-Host "Arrancando STREAMCUT AI..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}
if ($ok) {
  Write-Host "STREAMCUT AI esta en marcha: http://localhost:3000" -ForegroundColor Green
  if (-not $SinNavegador) { Start-Process "http://localhost:3000" }
} else {
  Write-Host "No responde todavia. Mira las ventanas 'STREAMCUT - servidor' y 'STREAMCUT - web' por si hay errores." -ForegroundColor Yellow
}
