$ErrorActionPreference = 'Stop'
Set-Location -Path 'C:\Amitel\Autowin OS'
& "$PWD\node_modules\.bin\vitest.cmd" run src/main/security-critical-fixes.test.ts src/main/providers/codex.test.ts
exit $LASTEXITCODE
