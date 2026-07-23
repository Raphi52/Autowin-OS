# Signal RUN git-source-control : rejoue les tests de la feature dans le worktree worktrees-in-chat.
$ErrorActionPreference = 'Stop'
$wt = 'C:\Amitel\Autowin-OS-wt\worktrees-in-chat'
Set-Location -Path $wt
& "$wt\node_modules\.bin\vitest.cmd" run `
  src/shared/git-read.test.ts `
  src/renderer/src/components/SourceControlPane.test.tsx `
  src/renderer/src/components/ChatView.behavior.test.tsx
exit $LASTEXITCODE
