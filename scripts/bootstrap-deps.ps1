<#
.SYNOPSIS
  Bootstrap des dépendances EXTERNES d'Autowin OS pour une nouvelle machine (collègue).

  L'installeur NSIS pose l'APP ; ce script configure ce qu'il ne peut pas : les CLI providers et le
  venv du brain_server. Il est IDEMPOTENT (ne réinstalle pas ce qui est déjà là) et HONNÊTE : il
  n'automatise JAMAIS un secret ni un login interactif (token Brain, OAuth Codex) — il les GUIDE.

  Ce qu'il fait :
    - installe les CLI codex (@openai/codex) et claude (@anthropic-ai/claude-code) si absentes ;
    - prépare Graphify depuis la source partagée GED avec un cache uv local par machine ;
    - crée/complète le venv Python du brain_server (uv venv + requirements) dans le tooling résolu ;
  Ce qu'il GUIDE (manuel, non automatisable) :
    - login OAuth Codex (npm run codex:login), token Brain (AMITEL_BRAIN_TOKEN), Kimi Code (optionnel).

.PARAMETER HermesBrainRepo
  Clone LOCAL du depot Hermes-Brain : la SEULE source de confiance du code Python du Brain. Son
  install.ps1 pose le runtime exactement la ou l app le cherche (%LOCALAPPDATA%\AmitelBrain).
  Defaut = env AUTOWIN_HERMES_BRAIN_REPO, sinon %USERPROFILE%\Hermes-Brain.

.PARAMETER BrainRoot
  Racine du CORPUS (les notes knowledge/), transmise a install.ps1. Defaut = env AMITEL_BRAIN_ROOT,
  sinon le partage GED Amitel. Le partage porte les DONNEES ; jamais le code que la machine execute.

.PARAMETER SkipCli   Ne pas toucher aux CLI npm.
.PARAMETER SkipGraphify Ne pas préparer Graphify depuis la GED.
.PARAMETER SkipBrain Ne pas toucher au venv brain.
#>
[CmdletBinding()]
param(
  [string]$HermesBrainRepo = $(if ($env:AUTOWIN_HERMES_BRAIN_REPO) { $env:AUTOWIN_HERMES_BRAIN_REPO } else { Join-Path $env:USERPROFILE 'Hermes-Brain' }),
  [string]$BrainRoot = $(if ($env:AMITEL_BRAIN_ROOT) { $env:AMITEL_BRAIN_ROOT } else { '\\ged2\rig\Projets IA\Amitel Brain' }),
  [string]$GraphifySource = $(if ($env:AUTOWIN_GRAPHIFY_SOURCE) { $env:AUTOWIN_GRAPHIFY_SOURCE } else { '\\ged2\rig\Projets IA\Graphify' }),
  [switch]$SkipCli,
  [switch]$SkipGraphify,
  [switch]$SkipBrain
)
$ErrorActionPreference = 'Stop'
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
  $clis = @(
    @{ Bin = 'codex';  Pkg = '@openai/codex' },
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

# --- Graphify partagé ---
if (-not $SkipGraphify) {
  Step "Graphify partagé vérifié (wheelhouse GED, installation locale hors ligne)"
  $wheelName = 'graphifyy-0.9.11-py3-none-any.whl'
  $expectedHash = '750B77232F460275ABA596B09A1B8F289A1238A41EF5AD0EDC29464E523B28CA'
  $expectedRequirementsHash = 'F1240F8372936D5EE15DD2CDF6BACE762C998D57845EC64373723D6517084436'
  $sharedDistribution = Join-Path $GraphifySource 'dist\amitel-v0.9.11'
  $sharedWheel = Join-Path $sharedDistribution $wheelName
  $sharedRequirements = Join-Path $sharedDistribution 'requirements.lock'
  $sharedWheelhouse = Join-Path $sharedDistribution 'wheelhouse'
  $cacheRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Amitel\Autowin OS\graphify'
  $localDistribution = Join-Path $cacheRoot 'distribution'
  $localWheel = Join-Path $localDistribution $wheelName
  $localRequirements = Join-Path $localDistribution 'requirements.lock'
  $localWheelhouse = Join-Path $localDistribution 'wheelhouse'
  $venv = Join-Path $cacheRoot '.venv'
  $venvPython = Join-Path $venv 'Scripts\python.exe'
  $venvGraphify = Join-Path $venv 'Scripts\graphify.exe'
  if (-not (Test-Path $sharedWheel) -or (Get-FileHash -Algorithm SHA256 $sharedWheel).Hash -ne $expectedHash) {
    throw "artefact Graphify GED absent ou empreinte invalide : $sharedWheel"
  }
  if (-not (Test-Path $sharedRequirements) -or (Get-FileHash -Algorithm SHA256 $sharedRequirements).Hash -ne $expectedRequirementsHash) {
    throw "lock Graphify GED absent ou empreinte invalide : $sharedRequirements"
  }
  if (-not (Test-Path $sharedWheelhouse)) {
    throw "wheelhouse Graphify GED absent : $sharedWheelhouse"
  }
  if (-not (Have 'uv')) {
    throw "'uv' absent → installer avec 'winget install astral-sh.uv', puis relancer le bootstrap."
  }
  New-Item -ItemType Directory -Force -Path $localDistribution, $localWheelhouse | Out-Null
  Copy-Item -LiteralPath $sharedWheel, $sharedRequirements -Destination $localDistribution -Force
  Copy-Item -Path (Join-Path $sharedWheelhouse '*') -Destination $localWheelhouse -Force
  if ((Get-FileHash -Algorithm SHA256 $localWheel).Hash -ne $expectedHash -or
      (Get-FileHash -Algorithm SHA256 $localRequirements).Hash -ne $expectedRequirementsHash) {
    throw 'distribution Graphify invalide après copie locale'
  }
  uv venv --python 3.12 --no-managed-python --no-python-downloads --clear $venv
  if ($LASTEXITCODE -ne 0) { throw 'impossible de créer le venv Graphify local avec Python 3.12' }
  uv pip install --python $venvPython --no-index --find-links $localWheelhouse --require-hashes --requirement $localRequirements
  if ($LASTEXITCODE -ne 0) { throw 'échec installation hors ligne des dépendances Graphify verrouillées' }
  uv pip install --python $venvPython --no-index --no-deps $localWheel
  if ($LASTEXITCODE -ne 0) { throw 'échec installation hors ligne du wheel Graphify vérifié' }
  @{
    version = '0.9.11'
    wheelSha256 = $expectedHash.ToLowerInvariant()
    requirementsSha256 = $expectedRequirementsHash.ToLowerInvariant()
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cacheRoot 'installation.json') -Encoding UTF8
  & $venvGraphify --version
  if ($LASTEXITCODE -ne 0) { throw 'installation Graphify locale inutilisable' }
  Ok "Graphify 0.9.11 installé hors ligne depuis le wheelhouse GED vérifié"
} else { Step "Graphify partagé — ignoré (-SkipGraphify)" }

# --- Runtime Brain (venv + tooling), DELEGUE a Hermes-Brain ---
#
# On ne recree PAS ici ce que install.ps1 sait deja faire. Deux raisons, pas une preference de style :
#  1. la cible. L app interroge %LOCALAPPDATA%\AmitelBrain\.venv\Scripts\python.exe
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
  $brainPython = Join-Path $env:LOCALAPPDATA "AmitelBrain\.venv\Scripts\python.exe"
  if (Test-Path $brainPython) { Ok "runtime deja installe ($brainPython)" }
  elseif (-not (Test-Path $brainInstaller)) {
    Warn "clone Hermes-Brain introuvable : $HermesBrainRepo"
    Warn "  git clone https://github.com/Raphi52/Hermes-Brain.git `"$HermesBrainRepo`""
    Warn "  puis relancer ce script (ou passer -HermesBrainRepo <chemin>)."
  }
  elseif (-not (Have "uv")) {
    Warn "uv absent (createur du venv) -> installer https://docs.astral.sh/uv/ , puis relancer -SkipCli -SkipGraphify."
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
if ($env:AMITEL_BRAIN_TOKEN) { Ok "AMITEL_BRAIN_TOKEN défini" }
else { Warn "AMITEL_BRAIN_TOKEN absent → le définir (secret Brain) pour activer le RAG." }
Warn "Login OAuth Codex : dans le repo Autowin OS, 'npm run codex:login'."
Write-Host "`nEnsuite : lancer Autowin OS. Le wizard n'apparaît QUE s'il reste un rouge, tente de démarrer le brain, et guide le reste." -ForegroundColor White
