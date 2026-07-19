param(
  [string]$Root = 'C:\Amitel\Autowin OS',
  [string]$Package = 'dist\win-unpacked\resources\app.asar'
)

$ErrorActionPreference = 'Stop'
$sourceRoots = @(
  (Join-Path $Root 'src'),
  (Join-Path $Root 'package.json'),
  (Join-Path $Root 'electron.vite.config.ts'),
  (Join-Path $Root 'electron-builder.yml')
)
$files = foreach ($candidate in $sourceRoots) {
  if (Test-Path -LiteralPath $candidate -PathType Container) {
    Get-ChildItem -LiteralPath $candidate -Recurse -File
  } elseif (Test-Path -LiteralPath $candidate -PathType Leaf) {
    Get-Item -LiteralPath $candidate
  }
}
if (-not $files) { throw 'Aucune source trouvée.' }
$latestSource = $files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$packagePath = Join-Path $Root $Package
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Package absent: $packagePath" }
$packageFile = Get-Item -LiteralPath $packagePath
if ($packageFile.LastWriteTimeUtc -lt $latestSource.LastWriteTimeUtc) {
  throw "STALE package: $($packageFile.LastWriteTimeUtc.ToString('o')) < $($latestSource.FullName) $($latestSource.LastWriteTimeUtc.ToString('o'))"
}
[pscustomobject]@{
  status = 'fresh'
  package = $packageFile.FullName
  packageTimestamp = $packageFile.LastWriteTimeUtc.ToString('o')
  latestSource = $latestSource.FullName
  latestSourceTimestamp = $latestSource.LastWriteTimeUtc.ToString('o')
} | ConvertTo-Json -Compress
