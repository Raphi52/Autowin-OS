$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'clean-generated-artifacts.ps1'
$outsideRoot = Join-Path ([IO.Path]::GetTempPath()) ("autowin-clean-boundary-" + [Guid]::NewGuid().ToString('N'))
$canary = Join-Path $outsideRoot 'dist-clean-canary'
$failure = $null

try {
  New-Item -ItemType Directory -Path $canary -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $canary 'sentinel.txt'), 'must survive rejected root')

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell -ExecutionPolicy Bypass -File $scriptPath -ProjectRoot $outsideRoot 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction

  if ($exitCode -eq 0) {
    $failure = "Expected an external ProjectRoot to be rejected, got exit 0: $output"
  } elseif (-not (Test-Path -LiteralPath (Join-Path $canary 'sentinel.txt') -PathType Leaf)) {
    $failure = 'External canary was deleted before ProjectRoot was rejected.'
  }
} finally {
  if (Test-Path -LiteralPath $outsideRoot) {
    Remove-Item -LiteralPath $outsideRoot -Recurse -Force
  }
}

if ($failure) {
  throw $failure
}

Write-Output 'External ProjectRoot rejected without deletion.'
