$ErrorActionPreference = 'Stop'
$wt = 'C:\Amitel\Autowin-OS-wt\hooks'
Set-Location -Path $wt
& "$wt\node_modules\.bin\vitest.cmd" run src/main/hooks src/main/orchestrator.hooks.test.ts src/main/gates
exit $LASTEXITCODE
