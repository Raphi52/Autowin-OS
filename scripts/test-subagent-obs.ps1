# Signal-cmd : observation honnête des sous-agents (#2 thinking, #3 échecs, #4 evidence Claude).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/main/providers/thinking `
  src/main/providers/claude.evidence `
  src/main/providers/codex.evidence `
  src/renderer/src/components/ChatView.parts.evidence `
  src/main/orchestrator
exit $LASTEXITCODE
