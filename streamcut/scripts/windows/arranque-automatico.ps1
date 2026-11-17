# STREAMCUT AI - arrancar automaticamente al iniciar sesion en Windows.
#   Activar:     powershell -ExecutionPolicy Bypass -File scripts\windows\arranque-automatico.ps1
#   Desactivar:  powershell -ExecutionPolicy Bypass -File scripts\windows\arranque-automatico.ps1 -Quitar
param([switch]$Quitar)
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "STREAMCUT AI.lnk"
if ($Quitar) {
  Remove-Item $lnk -ErrorAction SilentlyContinue
  Write-Host "Arranque automatico desactivado." -ForegroundColor Yellow
  exit 0
}
$script = (Resolve-Path "$PSScriptRoot\iniciar.ps1").Path
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = "powershell.exe"
$s.Arguments = "-ExecutionPolicy Bypass -WindowStyle Minimized -File `"$script`" -SinNavegador"
$s.WorkingDirectory = Split-Path $script
$s.Description = "Arranca STREAMCUT AI"
$s.Save()
Write-Host "Listo: STREAMCUT AI arrancara solo cada vez que inicies sesion en Windows." -ForegroundColor Green
