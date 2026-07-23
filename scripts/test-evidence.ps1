# Signal-cmd de la feature "diff + stdout/exit inline dans le Chat".
# Couvre la couche données (structuredEvidenceFields) ET le rendu (StepThread evidence).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/main/providers/codex.evidence `
  src/renderer/src/components/ChatView.parts.evidence
exit $LASTEXITCODE
