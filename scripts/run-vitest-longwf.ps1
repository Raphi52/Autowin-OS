# Signal RUN long-multiagent-workflows : rejoue les tests du fix #2 dans le worktree dédié.
$ErrorActionPreference = 'Stop'
$wt = 'C:\Amitel\Autowin-OS-wt\long-workflows'
Set-Location -Path $wt
& "$wt\node_modules\.bin\vitest.cmd" run `
  src/main/orchestrator.context-dedup.test.ts `
  src/main/orchestrator.lean-fast.test.ts `
  src/main/orchestrator.fanout.test.ts
exit $LASTEXITCODE
