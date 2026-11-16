# STREAMCUT AI — arranque en Windows. Abre http://localhost:3000
$root = Resolve-Path "$PSScriptRoot\..\.."
$envFile = Get-Content "$root\.env" -ErrorAction SilentlyContinue
if ($envFile -match '^STREAMCUT_DATABASE_URL=sqlite') {
  $env:STREAMCUT_DATABASE_URL = "sqlite:///$($root -replace '\\','/')/data/streamcut.db"
}
$env:STREAMCUT_DATA_DIR = "$root\data"

# Backend (en modo all-in-one arranca también los workers y el monitor de directos)
Start-Process -WorkingDirectory "$root\backend" -FilePath "$root\backend\.venv\Scripts\uvicorn.exe" `
  -ArgumentList "app.main:app","--host","127.0.0.1","--port","8000" -WindowStyle Minimized

# Si usas PostgreSQL + Redis (STREAMCUT_RUN_MODE=api), arranca también worker y monitor:
if ($envFile -match '^STREAMCUT_RUN_MODE=api') {
  Start-Process -WorkingDirectory "$root\backend" -FilePath "$root\backend\.venv\Scripts\dramatiq.exe" `
    -ArgumentList "app.workers.tasks","--processes","1","--threads","2" -WindowStyle Minimized
  Start-Process -WorkingDirectory "$root\backend" -FilePath "$root\backend\.venv\Scripts\python.exe" `
    -ArgumentList "-m","app.live.monitor" -WindowStyle Minimized
}

Start-Process -WorkingDirectory "$root\frontend" -FilePath "npx.cmd" -ArgumentList "next","start","-p","3000" -WindowStyle Minimized
Start-Sleep -Seconds 6
Start-Process "http://localhost:3000"
Write-Host "STREAMCUT AI en marcha: http://localhost:3000 (cierra las ventanas minimizadas para detenerlo)"
