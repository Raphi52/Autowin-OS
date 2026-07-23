<#
.SYNOPSIS
  Bootstrap des dépendances EXTERNES d'Autowin OS pour une nouvelle machine (collègue).

  L'installeur NSIS pose l'APP ; ce script configure ce qu'il ne peut pas : les CLI providers et le
  venv du brain_server. Il est IDEMPOTENT (ne réinstalle pas ce qui est déjà là) et HONNÊTE : il
  n'automatise JAMAIS un secret ni un login interactif (token Brain, OAuth Codex) — il les GUIDE.

  Ce qu'il fait :
    - installe les CLI codex (@openai/codex) et claude (@anthropic-ai/claude-code) si absentes ;
    - crée/complète le venv Python du brain_server (uv venv + requirements) dans le tooling résolu ;
  Ce qu'il GUIDE (manuel, non automatisable) :
    - login OAuth Codex (npm run codex:login), token Brain (AMITEL_BRAIN_TOKEN), Kimi Code (optionnel).

.PARAMETER BrainTooling
  Dossier `tooling/` du Brain (contient brain_server.py + requirements.txt). Défaut = env
  AUTOWIN_BRAIN_TOOLING, sinon le partage GED Amitel. Pointer un dossier LOCAL pour un venv par machine.

.PARAMETER SkipCli   Ne pas toucher aux CLI npm.
.PARAMETER SkipBrain Ne pas toucher au venv brain.
#>
[CmdletBinding()]
param(
  [string]$BrainTooling = $(if ($env:AUTOWIN_BRAIN_TOOLING) { $env:AUTOWIN_BRAIN_TOOLING } else { '\\ged2\rig\Projets IA\Amitel Brain\tooling' }),
  [switch]$SkipCli,
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

# --- Brain venv ---
if (-not $SkipBrain) {
  Step "brain_server (venv Python par machine)"
  if (-not (Test-Path (Join-Path $BrainTooling 'brain_server.py'))) {
    Warn "tooling introuvable : $BrainTooling — passer -BrainTooling <chemin> (ou définir AUTOWIN_BRAIN_TOOLING). venv NON créé."
  }
  elseif (-not (Have 'uv')) {
    Warn "'uv' absent (gestionnaire venv) → installer : https://docs.astral.sh/uv/ , puis relancer -SkipCli."
  }
  else {
    Push-Location $BrainTooling
    try {
      if (Test-Path (Join-Path $BrainTooling '.venv\Scripts\python.exe')) { Ok ".venv déjà présent" }
      else { Warn "création .venv…"; uv venv; Ok ".venv créé" }
      Warn "installation des requirements (fastembed etc., peut durer)…"
      uv pip install -r requirements.txt
      if ($LASTEXITCODE -eq 0) { Ok "requirements installés" } else { Warn "échec uv pip install — vérifier requirements.txt" }
    } finally { Pop-Location }
  }
} else { Step "brain venv — ignoré (-SkipBrain)" }

# --- À faire manuellement (secrets / interactif) ---
Step "Manuel (non automatisable)"
if ($env:AMITEL_BRAIN_TOKEN) { Ok "AMITEL_BRAIN_TOKEN défini" }
else { Warn "AMITEL_BRAIN_TOKEN absent → le définir (secret Brain) pour activer le RAG." }
Warn "Login OAuth Codex : dans le repo Autowin OS, 'npm run codex:login'."
Write-Host "`nEnsuite : lancer Autowin OS. Le wizard n'apparaît QUE s'il reste un rouge, tente de démarrer le brain, et guide le reste." -ForegroundColor White
