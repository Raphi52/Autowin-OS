param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$canonicalRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$requestedRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
if (-not $requestedRoot.Equals($canonicalRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "ProjectRoot hors workspace refusé : $requestedRoot"
}
$ProjectRoot = $canonicalRoot
$root = $canonicalRoot + '\'
$targets = @(
  (Join-Path $ProjectRoot 'attachment-button-check.png')
)
$targets += @(Get-ChildItem -LiteralPath $ProjectRoot -File -Filter 'harness-timeline-*.png' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$targets += @(Get-ChildItem -LiteralPath $ProjectRoot -Directory -Filter 'dist-*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$sketchRoot = Join-Path $ProjectRoot 'sketches'
if (Test-Path -LiteralPath $sketchRoot) {
  $targets += @(Get-ChildItem -LiteralPath $sketchRoot -Directory -Filter '*-converge' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
}
$integrationRoot = Join-Path $ProjectRoot 'integrations'
if (Test-Path -LiteralPath $integrationRoot) {
  $targets += @(Get-ChildItem -LiteralPath $integrationRoot -Directory -Filter '__pycache__' -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
}

$existingTargets = [Collections.Generic.List[string]]::new()
foreach ($candidate in ($targets | Select-Object -Unique)) {
  $target = [IO.Path]::GetFullPath($candidate)
  if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Cible hors workspace refusée : $target"
  }
  if (Test-Path -LiteralPath $target) {
    $existingTargets.Add($target)
  }
}

if ($Check) {
  if ($existingTargets.Count -gt 0) {
    throw "Generated artifacts present: $($existingTargets -join ', ')"
  }
  Write-Output 'Generated artifacts present: 0'
  return
}

foreach ($target in $existingTargets) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
Write-Output "Generated artifacts removed: $($existingTargets.Count)"
