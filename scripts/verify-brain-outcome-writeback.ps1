$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  & npm exec vitest run -- `
    --exclude "artifacts/**" `
    --reporter=dot `
    src/main/outcome-learning.integration.test.ts `
    src/main/outcome-learning-policy.test.ts `
    src/main/outcome-learning-proposal.test.ts `
    src/main/activity/outcome-learning-ledger.test.ts `
    src/main/outcome-learning-projector.test.ts `
    src/main/outcome-learning-supervisor.test.ts `
    src/main/outcome-learning-curation.test.ts `
    src/main/outcome-learning-curation-transaction.test.ts `
    src/main/providers/causal-verification-evidence.test.ts `
    src/main/providers/learning-oracle-manifest.test.ts `
    src/main/phase-briefs.test.ts `
    src/main/activity/orchestration-outcome-trace.test.ts `
    src/shared/orchestration-outcome.test.ts `
    src/main/brain-protocol.test.ts `
    src/main/brain-remember.test.ts `
    src/main/brain-inbox.test.ts `
    src/main/brain-inbox-race.test.ts `
    src/main/amitel-context.test.ts `
    src/renderer/src/components/BehaviourView.test.tsx `
    src/renderer/src/components/GraphView.panels.test.tsx
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
