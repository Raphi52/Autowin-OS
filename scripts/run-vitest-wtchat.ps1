# Signal RUN worktrees-in-chat : rejoue les tests de la feature dans le worktree dédié.
$ErrorActionPreference = 'Stop'
$wt = 'C:\Amitel\Autowin-OS-wt\worktrees-in-chat'
Set-Location -Path $wt
& "$wt\node_modules\.bin\vitest.cmd" run `
  src/renderer/src/components/ChatWorktreePanel.test.tsx `
  src/renderer/src/components/ChatView.behavior.test.tsx
exit $LASTEXITCODE
