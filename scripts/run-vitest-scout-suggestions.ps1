# Signal RUN scout-suggestions-array : rejoue les tests de la feature (parser + grouping + rendu).
# Exit 0 = vert. N'inclut PAS le typecheck whole-tree (rouge externe transitoire = session concurrente).
$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/renderer/src/components/scout-suggestions.test.ts `
  src/renderer/src/components/SuggestionGrid.test.tsx `
  src/renderer/src/components/chat-view-model.suggestions.test.ts
exit $LASTEXITCODE
