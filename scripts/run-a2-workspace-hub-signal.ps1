param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label a échoué avec le code $LASTEXITCODE."
  }
}

Invoke-Checked 'Tests lifecycle A2' {
  & npx vitest run `
    src/main/store/worktree-repository.test.ts `
    src/main/store/worktree-run-state.test.ts `
    src/main/store/worktree-manager.test.ts `
    src/main/store/run-worktree-coordinator.test.ts `
    src/main/store/worktree-recovery.integration.test.ts `
    src/main/commands.test.ts `
    src/main/orchestrator.mutation-negation.test.ts `
    src/main/orchestrator.worktree-flip.test.ts `
    src/main/os.execution-workspace.test.ts `
    src/main/os.readiness.test.ts
}

Invoke-Checked 'Tests Hub A2' {
  & npx vitest run `
    src/shared/worktree-activity-model.test.ts `
    src/renderer/src/components/WorktreeActivityView.test.tsx `
    src/renderer/src/components/WorktreeActivityView.style.test.ts `
    src/renderer/src/components/SourceControlPane.test.tsx
}

Invoke-Checked 'Typecheck' {
  & npm run typecheck
}

Invoke-Checked 'Diff check' {
  & git diff --check
}

Write-Output 'A2_WORKSPACE_HUB_SIGNAL_OK'
