# Signal RUN conv57-postmortem-fixes : rejoue les tests des 2 fixes (parseur markup + garde pilot).
$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/shared/stream-markup-filter.test.ts `
  src/main/agent-pilot.streaming.test.ts
exit $LASTEXITCODE
