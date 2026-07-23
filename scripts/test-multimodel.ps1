# Signal-cmd de la feature "binding multi-modèles par rôle" (fan-out topology + agrégation).
# Forme vettée fiable pour le stop-gate (powershell -NoProfile -File), évite le mangling
# des chemins multiples sous `cmd /c`. Exécute UNIQUEMENT les fichiers de la feature
# (évite le churn compute-fabric concurrent). Sort avec le code de vitest.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/main/quorum `
  src/main/roles `
  src/main/dashboards/cost `
  src/main/topology `
  src/main/orchestrator
exit $LASTEXITCODE
