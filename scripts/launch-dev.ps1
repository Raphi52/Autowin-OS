param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$manifest = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Projet Autowin OS introuvable : $ProjectRoot" }

$env:AUTOWIN_OS_DEV = '1'
$devMarker = 'title Autowin OS Dev && npm run dev'
function Get-DevTerminal {
  Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
    Where-Object { $_.CommandLine -like "*$devMarker*" } |
    Select-Object -First 1
}
# RELANCE (auto-update, redémarrage app) : l'ANCIEN terminal dev est encore vivant au moment où on
# est appelé — il ne meurt qu'après le `app.quit()` qui suit. Throw ici cassait la relance : le script
# levait, aucun nouveau dev n'était lancé, puis l'app quittait → « se ferme sans revenir ».
# On ATTEND donc sa disparition (poll borné) avant de lancer le nouveau ; s'il persiste au-delà, c'est
# un vrai doublon (dev lancé à la main ailleurs) → on refuse, comme avant.
$deadline = (Get-Date).AddSeconds(20)
while ((Get-DevTerminal) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 400  # sleep-ok: cadence de poll (<=500ms) de la disparition du terminal sortant
}
$existingDevTerminal = Get-DevTerminal
if ($existingDevTerminal) {
  throw "Autowin OS Dev est déjà lancé (PID $($existingDevTerminal.ProcessId))."
}
# La console reste ouverte pendant electron-vite, puis se ferme avec lui (/c) pour ne pas
# laisser de terminal orphelin. electron-vite --watch gère lui-même les redémarrages.
Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" `
  -ArgumentList @('/c', $devMarker) `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Minimized
