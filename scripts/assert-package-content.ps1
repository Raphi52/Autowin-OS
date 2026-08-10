param(
  [string]$Root = 'C:\Amitel\Autowin OS',
  [string]$Package = 'dist\win-unpacked\resources\app.asar'
)

$ErrorActionPreference = 'Stop'
$packagePath = if ([System.IO.Path]::IsPathRooted($Package)) { $Package } else { Join-Path $Root $Package }
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "Package absent: $packagePath"
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $projectRoot
try {
  $entries = @(& npx asar list $packagePath 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Lecture app.asar impossible (exit $LASTEXITCODE): $entries" }
} finally {
  Pop-Location
}

$forbidden = @($entries | Where-Object { "$_" -match '(^|[\\/])\.autowin-data([\\/]|$)' })
if ($forbidden.Count -gt 0) {
  throw "Données runtime interdites dans app.asar: $($forbidden -join ', ')"
}

$required = @(
  '\out\main\brain-worker.js',
  '\out\main\worktree-operation-worker.js'
)
$missing = @($required | Where-Object { $entries -notcontains $_ })
if ($missing.Count -gt 0) {
  throw "Workers runtime absents de app.asar: $($missing -join ', ')"
}

[pscustomobject]@{
  status = 'clean'
  package = (Resolve-Path -LiteralPath $packagePath).Path
  entries = $entries.Count
  forbiddenEntries = 0
  requiredWorkers = $required.Count
} | ConvertTo-Json -Compress
