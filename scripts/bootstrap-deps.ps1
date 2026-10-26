<#
.SYNOPSIS
  Bootstrap des dépendances EXTERNES d'Autowin OS pour une nouvelle machine (collègue).

  L'installeur NSIS pose l'APP ; ce script configure ce qu'il ne peut pas : les CLI providers et le
  venv du brain_server. Il est IDEMPOTENT (ne réinstalle pas ce qui est déjà là) et HONNÊTE : il
  n'automatise JAMAIS un secret ni un login interactif (token Brain, login Claude) — il les GUIDE.

  Ce qu'il fait :
    - installe la CLI claude (@anthropic-ai/claude-code) si absente ;
    - crée/complète le venv Python du brain_server (uv venv + requirements) dans le tooling résolu ;
  Ce qu'il GUIDE (manuel, non automatisable) :
    - login Claude (claude auth login) et token Brain (AUTOWIN_BRAIN_TOKEN, ou son ancien nom
      fourni par le profil d'entreprise entreprise/<nom>/identite.json).

.PARAMETER HermesBrainRepo
  Source de confiance du code Python du Brain. Son install.ps1 pose le runtime exactement la ou
  l app le cherche (%LOCALAPPDATA%\<dossier du Brain>, fixe par le profil d'entreprise).
  Defaut = env AUTOWIN_HERMES_BRAIN_REPO, sinon le dossier brain\ EMBARQUE dans ce depot, sinon
  %USERPROFILE%\Hermes-Brain (ancien clone externe, conserve comme repli).
  Le dossier brain\ est prioritaire : il est versionne avec l app, donc toujours coherent avec
  elle, et une machine neuve n a plus a cloner un second depot avant de bootstrapper.

.PARAMETER BrainRoot
  Racine du CORPUS (les notes knowledge/), transmise a install.ps1. Defaut = env AUTOWIN_BRAIN_ROOT
  (ou son ancien nom), sinon la racine partagee du profil d'entreprise. Le partage porte les DONNEES ;
  jamais le code que la machine execute.

.PARAMETER SkipCli   Ne pas toucher aux CLI npm.
.PARAMETER SkipBrain Ne pas toucher au venv brain.
#>
[CmdletBinding()]
param(
  # Défaut résolu APRÈS le bloc param : sous Windows PowerShell 5.1, $PSScriptRoot y est vide
  # (Split-Path échouait sur une chaîne vide avant même le premier Write-Host).
  [string]$HermesBrainRepo = '',
  [string]$BrainRoot = '',
  [switch]$SkipCli,
  [switch]$SkipBrain
)
$ErrorActionPreference = 'Stop'
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
# Profil d'entreprise (entreprise/<nom>/identite.json) : racine partagee, dossiers et anciens noms
# deja poses sur ses postes. Absent (version publique) : valeurs neutres.
. (Join-Path (Split-Path -Parent $scriptDir) 'brain\integrations\windows\identite.ps1')
$identite = Get-BrainIdentite (Split-Path -Parent $scriptDir)
$nomRacine = Get-BrainNomVariable $identite 'AUTOWIN_BRAIN_ROOT'
$nomJeton = Get-BrainNomVariable $identite 'AUTOWIN_BRAIN_TOKEN'
if (-not $BrainRoot) {
  $BrainRoot = if ($env:AUTOWIN_BRAIN_ROOT) { $env:AUTOWIN_BRAIN_ROOT }
    elseif ([Environment]::GetEnvironmentVariable($nomRacine)) { [Environment]::GetEnvironmentVariable($nomRacine) }
    else { $identite.racinePartagee }
}
if (-not $HermesBrainRepo) {
  $embeddedBrain = Join-Path (Split-Path -Parent $scriptDir) 'brain'
  $HermesBrainRepo = if ($env:AUTOWIN_HERMES_BRAIN_REPO) { $env:AUTOWIN_HERMES_BRAIN_REPO }
    elseif (Test-Path (Join-Path $embeddedBrain 'install.ps1')) { $embeddedBrain }
    else { Join-Path $env:USERPROFILE 'Hermes-Brain' }
}
function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]    $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n== $m ==" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "Bootstrap dépendances Autowin OS" -ForegroundColor White

# --- Prérequis ---
Step "Prérequis"
if (-not (Have 'node')) { throw "node/npm requis (installer Node.js d'abord)." }
Ok "node $(node --version)"

# --- Garde-fou git partagé (anti-collision) ---
Step "Hooks git partagés (.githooks)"
if (Have 'git') {
  $current = (git config --get core.hooksPath) 2>$null
  if ($current -eq '.githooks') { Ok "core.hooksPath déjà sur .githooks" }
  else {
    git config core.hooksPath .githooks
    if ($LASTEXITCODE -eq 0) { Ok "core.hooksPath = .githooks (push direct sur main refusé)" }
    else { Warn "échec git config core.hooksPath — le faire à la main : git config core.hooksPath .githooks" }
  }
} else { Warn "git absent — impossible d'activer les hooks partagés." }

# --- CLI providers ---
if (-not $SkipCli) {
  Step "CLI providers (npm global)"
  # Claude est le seul moteur branche : Codex, Kimi et Gemini sont retires, on n'installe plus
  # leur CLI au bootstrap.
  $clis = @(
    @{ Bin = 'claude'; Pkg = '@anthropic-ai/claude-code' }
  )
  foreach ($c in $clis) {
    if (Have $c.Bin) { Ok "$($c.Bin) déjà présent" }
    else {
      Warn "$($c.Bin) absent → npm i -g $($c.Pkg)"
      npm install -g $c.Pkg
      if ($LASTEXITCODE -eq 0 -and (Have $c.Bin)) { Ok "$($c.Bin) installé" }
      else { Warn "échec install $($c.Bin) — installer manuellement : npm i -g $($c.Pkg)" }
    }
  }
  Warn "Kimi Code (optionnel, standby par défaut) : installer séparément puis 'kimi login' si utilisé."
} else { Step "CLI providers — ignoré (-SkipCli)" }

# --- Runtime Brain (venv + tooling), DELEGUE a Hermes-Brain ---
#
# On ne recree PAS ici ce que install.ps1 sait deja faire. Deux raisons, pas une preference de style :
#  1. la cible. L app interroge %LOCALAPPDATA%\<dossier du Brain>\.venv\Scripts\python.exe
#     (resolveBrainRuntime, brain-server-launch.ts). La version precedente de ce bloc creait le venv
#     dans le dossier tooling passe en parametre -- dont le defaut etait le partage GED. Lance tel
#     quel sur une machine neuve, il posait donc un venv que l app ne regarde jamais, et l ecran
#     d accueil restait rouge apres un bootstrap annonce comme reussi.
#  2. la source. Le code Python execute vient du clone Hermes-Brain, jamais du partage : la GED est
#     un corpus de donnees, ecrivable par tout le service. install.ps1 copie le tooling depuis le
#     clone et ecrit config.json, ce que ce script ne sait pas faire.
if (-not $SkipBrain) {
  Step "runtime Brain (venv + tooling, via Hermes-Brain)"
  $brainInstaller = Join-Path $HermesBrainRepo "install.ps1"
  $brainPython = Join-Path $env:LOCALAPPDATA "$($identite.dossierLocal)\.venv\Scripts\python.exe"
  if (Test-Path $brainPython) { Ok "runtime deja installe ($brainPython)" }
  elseif (-not (Test-Path $brainInstaller)) {
    Warn "install.ps1 introuvable : $HermesBrainRepo"
    Warn "  normalement le dossier brain\ embarque dans ce depot suffit -- verifier qu il est bien la."
    Warn "  repli possible : git clone https://github.com/Raphi52/Hermes-Brain.git `"$HermesBrainRepo`""
    Warn "  puis relancer ce script (ou passer -HermesBrainRepo <chemin>)."
  }
  elseif (-not (Have "uv")) {
    Warn "uv absent (createur du venv) -> installer https://docs.astral.sh/uv/ , puis relancer -SkipCli."
  }
  else {
    Warn "installation du runtime Brain (fastembed etc., peut durer plusieurs minutes)..."
    & $brainInstaller -BrainRoot $BrainRoot
    # Le VERDICT est le fichier que l app ira chercher, pas le code de sortie de l installeur :
    # c est la seule chose dont depend reellement l ecran d accueil.
    if (Test-Path $brainPython) { Ok "runtime Brain installe ($brainPython)" }
    else { Warn "install.ps1 termine mais $brainPython est absent -- relire sa sortie ci-dessus." }
  }
} else { Step "runtime Brain -- ignore (-SkipBrain)" }

# --- À faire manuellement (secrets / interactif) ---
Step "Manuel (non automatisable)"
if ($env:AUTOWIN_BRAIN_TOKEN -or [Environment]::GetEnvironmentVariable($nomJeton)) { Ok "jeton Brain défini" }
else { Warn "$nomJeton absent → le définir (secret Brain) pour activer le RAG." }
Warn "Login Claude : 'claude auth login' (ou le bouton « Se connecter » du wizard)."
Write-Host "`nEnsuite : lancer Autowin OS. Le wizard n'apparaît QUE s'il reste un rouge, tente de démarrer le brain, et guide le reste." -ForegroundColor White
