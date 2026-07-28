$ErrorActionPreference = 'Stop'
Set-Location -Path 'C:\Amitel\Autowin OS'
& "$PWD\node_modules\.bin\vitest.cmd" run src/main/runs/turn-journal.test.ts
exit $LASTEXITCODE
