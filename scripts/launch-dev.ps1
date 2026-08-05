param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  # Injecté par le test. En vrai : `Start-DevLoop`, qui n'alloue AUCUNE console (voir plus bas).
  [scriptblock]$Launcher = $null
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
# Le processus reste vivant pendant electron-vite ; `/c` le ferme avec lui et évite tout orphelin.
#
# POURQUOI PAS `Start-Process -WindowStyle Hidden` : ce style pose `SW_HIDE` dans le `STARTUPINFO` du
# processus lancé. `conhost` l'honore — Windows Terminal l'IGNORE. Or Windows 11 route les nouvelles
# consoles vers Windows Terminal (« application de terminal par défaut »), qui affichait donc une
# fenêtre bien visible, titrée « Autowin OS Dev » par le `title` ci-dessus, à côté de l'app.
#
# `CREATE_NO_WINDOW` règle la cause au lieu du symptôme : aucune console n'est ALLOUÉE, donc aucun
# hôte de terminal n'entre en jeu et le réglage Windows de l'utilisateur devient sans effet. Les
# enfants (npm, electron-vite, electron) héritent de cette console sans fenêtre.
function Start-DevLoop {
  param([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory)
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $WorkingDirectory
  # UseShellExecute doit être $false pour que CreateNoWindow soit pris en compte ; l'environnement
  # courant (dont AUTOWIN_OS_DEV) est alors hérité tel quel.
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [void][System.Diagnostics.Process]::Start($psi)
}

# La ligne de commande reste `/c title Autowin OS Dev && npm run dev` au caractère près : c'est le
# marqueur que `Get-DevTerminal` cherche pour refuser un doublon et pour attendre la relance.
$lancer = if ($Launcher) { $Launcher } else { ${function:Start-DevLoop} }
& $lancer "$env:SystemRoot\System32\cmd.exe" "/c $devMarker" $ProjectRoot
