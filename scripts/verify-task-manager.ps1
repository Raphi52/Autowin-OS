param(
  [string]$ProofPath = "",
  [switch]$SkipLiveProof
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$expectedTests = @(
  "src/main/task-manager/schedule.test.ts",
  "src/main/task-manager/task-store.test.ts",
  "src/main/task-manager/task-scheduler.test.ts",
  "src/main/task-manager/windows-relay.test.ts",
  "src/main/task-manager/chat-dispatch.test.ts",
  "src/main/headless-instance.test.ts",
  "src/main/app-data.test.ts",
  "src/shared/navigation.test.ts",
  "src/renderer/src/components/TaskManagerView.test.tsx"
)

Push-Location $repoRoot
try {
  & node "scripts/task-manager-proof-validator.selftest.mjs"
  if ($LASTEXITCODE -ne 0) {
    throw "Le contrôle négatif du validateur Task Manager a échoué."
  }

  $missing = @($expectedTests | Where-Object { -not (Test-Path -LiteralPath $_) })
  if ($missing.Count -gt 0) {
    throw "Terrain rouge attendu : tests Task Manager manquants : $($missing -join ', ')"
  }

  & npx vitest run @expectedTests
  if ($LASTEXITCODE -ne 0) {
    throw "La suite Task Manager est rouge."
  }

  & npm run typecheck
  if ($LASTEXITCODE -ne 0) {
    throw "Le typecheck est rouge."
  }

  if (-not $SkipLiveProof) {
    if ([string]::IsNullOrWhiteSpace($ProofPath)) {
      throw "ProofPath est obligatoire pour la preuve live."
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/assert-ui-package-fresh.ps1"
    if ($LASTEXITCODE -ne 0) {
      throw "Le package utilisé par la preuve Task Manager est périmé."
    }
    & node "scripts/task-manager-proof-validator.mjs" --proof $ProofPath
    if ($LASTEXITCODE -ne 0) {
      throw "La preuve live Task Manager est invalide."
    }
    $proof = Get-Content -LiteralPath $ProofPath -Raw -Encoding utf8 | ConvertFrom-Json
    $executable = Join-Path $repoRoot "dist\win-unpacked\autowin-os.exe"
    $currentSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($proof.executableSha256 -ne $currentSha256) {
      throw "La preuve live ne correspond pas au binaire actuellement packagé."
    }
  }
} finally {
  Pop-Location
}
