$ErrorActionPreference = 'Stop'

$tests = @(
  'src/main/wire-provider-routing.test.ts',
  'src/main/wire-capabilities-runtime.test.ts',
  'src/main/wire-skill-runtime.test.ts',
  'src/main/wire-compute-fabric.test.ts',
  'src/main/wire-checkpoint-fork.test.ts',
  'src/main/shadow-router.test.ts',
  'src/renderer/src/components/wire-chat-events.test.tsx',
  'src/renderer/src/components/CapabilitiesView.test.tsx',
  'src/renderer/src/components/ObservatoryConnections.test.tsx',
  'src/renderer/src/components/BehaviourView.test.tsx'
)

$missing = @($tests | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count -gt 0) {
  Write-Error ("Tests de raccordement manquants:`n- " + ($missing -join "`n- "))
  exit 2
}

& npm exec vitest run @tests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm run typecheck
exit $LASTEXITCODE
