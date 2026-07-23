# Signal RUN scout-table-renderer : rejoue les tests de la feature dans le worktree dédié.
$ErrorActionPreference = 'Stop'
$wt = 'C:\Amitel\Autowin-OS-wt\scout-table'
Set-Location -Path $wt
& "$wt\node_modules\.bin\vitest.cmd" run `
  src/renderer/src/components/scout-table.test.ts `
  src/renderer/src/components/ScoutTable.test.tsx `
  src/renderer/src/components/ChatView.behavior.test.tsx
exit $LASTEXITCODE
