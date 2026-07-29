$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'clean-generated-artifacts.ps1'
$outsideRoot = Join-Path ([IO.Path]::GetTempPath()) ("autowin-clean-boundary-" + [Guid]::NewGuid().ToString('N'))
$canary = Join-Path $outsideRoot 'dist-clean-canary'
$projectRoot = Split-Path -Parent $PSScriptRoot
$auditRoot = Join-Path $projectRoot 'Audit'
$protectedPackage = Join-Path $auditRoot 'package-clean-protected-canary'
$generatedPackage = Join-Path $auditRoot 'package-clean-generated-canary'
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

  New-Item -ItemType Directory -Path $protectedPackage, $generatedPackage -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $protectedPackage 'RUN.md'), 'must survive generated cleanup')
  [IO.File]::WriteAllText((Join-Path $generatedPackage 'binary.bin'), 'generated package')

  & powershell -ExecutionPolicy Bypass -File $scriptPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $failure = "Canonical cleanup failed with exit $LASTEXITCODE."
  } elseif (-not (Test-Path -LiteralPath (Join-Path $protectedPackage 'RUN.md') -PathType Leaf)) {
    $failure = 'An Audit package containing RUN.md was deleted.'
  } elseif (Test-Path -LiteralPath $generatedPackage) {
    $failure = 'A generated Audit package without proof source survived cleanup.'
  }
} finally {
  if (Test-Path -LiteralPath $outsideRoot) {
    Remove-Item -LiteralPath $outsideRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $protectedPackage) {
    Remove-Item -LiteralPath $protectedPackage -Recurse -Force
  }
  if (Test-Path -LiteralPath $generatedPackage) {
    Remove-Item -LiteralPath $generatedPackage -Recurse -Force
  }
}

if ($failure) {
  throw $failure
}

Write-Output 'External root rejected; protected Audit package preserved; generated package removed.'
