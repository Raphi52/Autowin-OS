$ErrorActionPreference = 'Stop'

$fingerprintScript = Join-Path $PSScriptRoot 'worktree-fingerprint.ps1'
$projectRoot = Split-Path -Parent $PSScriptRoot
$canary = Join-Path $projectRoot 'harness-timeline-fingerprint-canary.png'
$failure = $null

try {
  [IO.File]::WriteAllText($canary, 'ignored generated artifact must invalidate fingerprint')
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell -ExecutionPolicy Bypass -File $fingerprintScript 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction

  if ($exitCode -eq 0) {
    $failure = "Expected an ignored generated artifact to invalidate the fingerprint, got: $output"
  } elseif (-not (Test-Path -LiteralPath $canary -PathType Leaf)) {
    $failure = 'Fingerprint check deleted the canary instead of remaining read-only.'
  }
} finally {
  if (Test-Path -LiteralPath $canary) {
    Remove-Item -LiteralPath $canary -Force
  }
}

if ($failure) {
  throw $failure
}

Write-Output 'Ignored generated artifact invalidates fingerprint without deletion.'
