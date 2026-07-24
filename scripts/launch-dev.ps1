param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$manifest = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Projet Autowin OS introuvable : $ProjectRoot" }

$env:AUTOWIN_OS_DEV = '1'
$devMarker = 'title Autowin OS Dev && npm run dev'
$existingDevTerminal = Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
  Where-Object { $_.CommandLine -like "*$devMarker*" } |
  Select-Object -First 1
if ($existingDevTerminal) {
  throw "Autowin OS Dev est déjà lancé (PID $($existingDevTerminal.ProcessId))."
}
# La console reste ouverte pendant electron-vite, puis se ferme avec lui (/c) pour ne pas
# laisser de terminal orphelin. electron-vite --watch gère lui-même les redémarrages.
Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" `
  -ArgumentList @('/c', $devMarker) `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Minimized
