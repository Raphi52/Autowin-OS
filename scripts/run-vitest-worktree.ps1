# Signal RUN worktree-cockpit-build : rejoue les tests des fichiers de l'incrément UI.
# Exit 0 = vert. Utilisé par le stop-gate (signal-cmd) et en local.
$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path $PSScriptRoot '..')
& npx vitest run `
  src/main/store/run-worktree-coordinator.test.ts `
  src/main/os.readiness.test.ts `
  src/main/orchestrator.worktree-flip.test.ts
exit $LASTEXITCODE
