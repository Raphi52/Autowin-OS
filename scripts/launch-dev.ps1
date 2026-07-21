param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$manifest = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Projet Autowin OS introuvable : $ProjectRoot" }

$env:AUTOWIN_OS_DEV = '1'
# electron-vite dev NE SURVIT PAS sans console (WindowStyle Hidden le tue) : on ouvre un vrai
# terminal persistant (cmd /k) minimisé. Le titre aide à le retrouver ; ferme-le pour couper le dev.
Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" `
  -ArgumentList @('/k', 'title Autowin OS Dev && npm run dev') `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Minimized
