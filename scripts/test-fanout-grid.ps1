# Signal-cmd : comparaison côte-à-côte des membres d'un fan-out (scout #5).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/renderer/src/components/fanout-grouping `
  src/renderer/src/components/ChatView.parts.evidence
exit $LASTEXITCODE
