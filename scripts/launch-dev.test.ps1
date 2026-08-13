$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "Assertion failed: $Message" }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$devCommand = $manifest.scripts.dev
Assert-True ($devCommand -eq 'electron-vite dev --watch') 'dev must delegate one watch loop to electron-vite'
Assert-True (($devCommand -split '--watch').Count -eq 2) 'dev must contain exactly one --watch flag'

$electronVite = Join-Path $projectRoot 'node_modules\.bin\electron-vite.cmd'
$help = & $electronVite dev --help 2>&1 | Out-String
Assert-True ($LASTEXITCODE -eq 0) 'electron-vite dev --help must succeed'
Assert-True ($help -match '--watch.*main process or preload script modules') `
  '--watch must cover main and preload; renderer remains on its dev-server hot update path'

# LE HAUT DE LA CHAÎNE NE DOIT PAS ÊTRE UNE APPLICATION CONSOLE.
# Viser powershell.exe donnait une console allouée par Windows, confiée à Windows Terminal sur
# Windows 11 — lequel ignore le SW_HIDE de `-WindowStyle Hidden` (fenêtre visible 242 ms, mesuré le
# 2026-08-05). `pyw.exe` est graphique : la contrainte est satisfaite par la CIBLE elle-même, donc le
# duo VBS + PowerShell n'a plus de raison d'être et la chaîne passe de cinq maillons à deux.
$shortcutSource = Get-Content -Raw (Join-Path $PSScriptRoot 'create-dev-shortcut.ps1')
Assert-True ($shortcutSource -match '\$shortcut\.TargetPath\s*=\s*\$interpreteur') `
  'the shortcut must target the resolved GUI Python interpreter'
Assert-True ($shortcutSource -match "notmatch '\(pyw\|pythonw\)") `
  'the creator must REFUSE a console interpreter (python.exe / py.exe) and say so'
Assert-True ($shortcutSource -notmatch '\$shortcut\.TargetPath\s*=[^
]*powershell\.exe') `
  'the shortcut must never target powershell.exe directly: Windows Terminal would show its console'
Assert-True ($shortcutSource -match "resources\\python\\pythonw\.exe") `
  'an EMBEDDED CPython must win over any interpreter on the PATH (Brain decision python-runtime)'

# LE LANCEUR PYTHON NE DOIT JAMAIS ÉCHOUER EN SILENCE.
# C'est le défaut réellement subi : `shell.Run commande, 0, False` ne récupérait pas le code de
# sortie, donc « déjà lancé » et un échec de compilation étaient tous deux invisibles. L'utilisateur
# double-cliquait, rien ne se passait, la fenêtre périmée restait à l'écran.
$launcherPy = Join-Path $PSScriptRoot 'launch_dev.py'
Assert-True (Test-Path -LiteralPath $launcherPy) 'the Python launcher must exist'
$pySource = Get-Content -Raw $launcherPy
Assert-True ($pySource -match 'MessageBoxW') `
  'without a console, a dialog box is the ONLY channel the user can see'
Assert-True ($pySource -match 'CreateMutexW') `
  'single instance must use the exact Windows primitive, not command-line sniffing'
Assert-True ($pySource -match 'CREATE_NO_WINDOW') 'the dev loop must start without allocating a console'
Assert-True ($pySource -match 'st_mtime >= avant') `
  'the launcher must PROVE the bundle was rebuilt after the last source change'
Assert-True ($pySource -match 'ATTENTE_FRAICHEUR_S') 'the freshness wait must be bounded, not infinite'
Assert-True (($pySource -split 'alerter\(').Count -ge 6) `
  'every abnormal exit must reach the user, not just the first one'

# L'ancien duo ne doit plus être RÉFÉRENCÉ : un raccourci qui pointe sur un fichier supprimé
# retomberait exactement dans l'échec muet qu'on vient de corriger.
Assert-True ($shortcutSource -notmatch 'launch-dev\.vbs') 'the VBS bootstrap must no longer be wired'
Assert-True ($shortcutSource -notmatch 'launch-dev\.ps1') 'the PowerShell launcher must no longer be wired'

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "autowin-launch-dev-test-$PID"
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
Set-Content -LiteralPath (Join-Path $fixtureRoot 'package.json') -Value '{}'

$script:processMode = 'existing'
$script:startCalls = @()
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($script:processMode -eq 'existing') {
    return [pscustomobject]@{
      ProcessId = 4242
      CommandLine = 'cmd.exe /c title Autowin OS Dev && npm run dev'
    }
  }
  return $null
}
# Le lanceur est injecté : la vraie implémentation crée un PROCESSUS (CREATE_NO_WINDOW), elle ne
# passe plus par Start-Process, dont le -WindowStyle Hidden était ignoré par Windows Terminal.
$launcherEspion = {
  param([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory)
  $script:startCalls += [pscustomobject]@{
    FilePath = $FilePath
    Arguments = $Arguments
    WorkingDirectory = $WorkingDirectory
  }
}

try {
  $duplicateError = $null
  try {
    . (Join-Path $PSScriptRoot 'launch-dev.ps1') -ProjectRoot $fixtureRoot -Launcher $launcherEspion
  } catch {
    $duplicateError = $_
  }
  Assert-True ($null -ne $duplicateError) 'a second dev terminal must be rejected'
  Assert-True ($duplicateError.Exception.Message -match '4242') 'duplicate rejection must identify the existing PID'
  Assert-True ($script:startCalls.Count -eq 0) 'duplicate rejection must not launch another terminal'

  $script:processMode = 'none'
  . (Join-Path $PSScriptRoot 'launch-dev.ps1') -ProjectRoot $fixtureRoot -Launcher $launcherEspion
  Assert-True ($script:startCalls.Count -eq 1) 'normal launch must delegate exactly once'
  Assert-True ($script:startCalls[0].Arguments -eq '/c title Autowin OS Dev && npm run dev') `
    'the delegated command must stay the unique marked dev loop, with /c so cmd exits with electron-vite'
  Assert-True ($script:startCalls[0].WorkingDirectory -eq $fixtureRoot) 'the dev loop must start in the requested project'

  # LA CAUSE, verrouillée sur la source : `-WindowStyle Hidden` posait SW_HIDE, que conhost honore
  # mais que Windows Terminal — terminal par defaut de Windows 11 — ignore. Une fenetre titree
  # « Autowin OS Dev » s'affichait donc a cote de l'app. Seul CREATE_NO_WINDOW n'alloue aucune
  # console, ce qui rend le reglage terminal de l'utilisateur sans effet.
  $launchSource = Get-Content -Raw (Join-Path $PSScriptRoot 'launch-dev.ps1')
  # Le CODE seul : sans cette mise à l'écart des commentaires, l'assertion suivante se déclenchait sur
  # la ligne d'explication qui NOMME `-WindowStyle Hidden` pour dire pourquoi on ne s'en sert plus.
  $launchCode = (Get-Content (Join-Path $PSScriptRoot 'launch-dev.ps1') |
    Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
  Assert-True ($launchSource -match '\$psi\.CreateNoWindow\s*=\s*\$true') `
    'the dev loop must allocate NO console (CREATE_NO_WINDOW), not merely hide a window style'
  Assert-True ($launchSource -match '\$psi\.UseShellExecute\s*=\s*\$false') `
    'CreateNoWindow is only honoured when UseShellExecute is false'
  Assert-True ($launchCode -notmatch 'Start-Process[^\r\n]*-WindowStyle\s+Hidden') `
    'no launch path may rely on -WindowStyle Hidden: Windows Terminal ignores it'
} finally {
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'PASS launch-dev watcher contract: renderer HMR, main/preload watch, single hidden launch, clean cmd exit'
