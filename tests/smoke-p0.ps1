# smoke-p0.ps1 -- signal rejouable Phase 0 (socle souverain). ASCII-only (PS 5.1 lit en cp1252).
# Prouve: (1) contrat d'adaptateur sur les 2 voies (tests unitaires),
#         (2) voie Claude LIVE + injection kit prouvee (reponse en majuscules),
#         (3) statut voie Codex (auth live = action user; contrat prouve hors-ligne).
# Exit 0 = P0 vert. Une voie bloquee est REPORTEE, jamais cachee.

$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $PSScriptRoot
Set-Location $proj
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$fail = 0

Write-Host "=== [1/3] Tests unitaires (contrat 2 voies: Claude parse + Codex device-code/SSE/injection) ==="
& npm test 2>&1 | Select-Object -Last 6
if ($LASTEXITCODE -ne 0) { Write-Host "UNIT KO"; $fail = 1 } else { Write-Host "UNIT OK" }

Write-Host ""
Write-Host "=== [2/3] Voie Claude LIVE (injection kit prouvee) ==="
$null | & npx tsx scripts/live-claude.mjs 2>&1 | Where-Object { $_ -notmatch 'Deprecation|trace-dep' } | Select-Object -Last 6
if ($LASTEXITCODE -ne 0) { Write-Host "CLAUDE LIVE KO"; $fail = 1 } else { Write-Host "CLAUDE LIVE OK (injection appliquee)" }

Write-Host ""
Write-Host "=== [3/3] Voie Codex ==="
$authPath = Join-Path $env:APPDATA 'autowin-os\auth.json'
if (Test-Path $authPath) {
  Write-Host "Codex authentifie (auth.json present) -- preuve LIVE via l'adaptateur:"
  $null | & npx tsx scripts/live-codex.mjs 2>&1 | Where-Object { $_ -notmatch 'Deprecation|trace-dep' } | Select-Object -Last 6
  if ($LASTEXITCODE -ne 0) { Write-Host "CODEX LIVE KO"; $fail = 1 } else { Write-Host "CODEX LIVE OK (injection appliquee)" }
} else {
  Write-Host "Codex: AUTH LIVE EN ATTENTE (action user: node scripts/codex-login.mjs)."
  Write-Host "       Contrat Codex PROUVE hors-ligne (7 tests: device-code, refresh, SSE, injection instructions). NON cache."
}

Write-Host ""
if ($fail -eq 0) {
  Write-Host "SMOKE P0 VERT: contrat 2 voies OK, Claude live + injection OK."
  exit 0
} else {
  Write-Host "SMOKE P0 ROUGE."
  exit 1
}
