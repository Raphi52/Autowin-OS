param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$canonicalRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$requestedRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
if (-not $requestedRoot.Equals($canonicalRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "ProjectRoot hors workspace refusé : $requestedRoot"
}
$cleanScript = Join-Path $PSScriptRoot 'clean-generated-artifacts.ps1'
$null = & $cleanScript -ProjectRoot $canonicalRoot -Check

Push-Location $canonicalRoot
try {
  $trackedHash = (& git diff --binary HEAD | & git hash-object --stdin).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $trackedHash) {
    throw 'Impossible de calculer l’empreinte du diff suivi.'
  }

  $manifest = [Collections.Generic.List[string]]::new()
  $manifest.Add("tracked`t$trackedHash")
  $untracked = @(& git ls-files --others --exclude-standard | Sort-Object)
  if ($LASTEXITCODE -ne 0) {
    throw 'Impossible d’énumérer les fichiers non suivis.'
  }
  foreach ($path in $untracked) {
    $contentHash = (& git hash-object -- $path).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $contentHash) {
      throw "Impossible de calculer l’empreinte de $path."
    }
    $manifest.Add("untracked`t$contentHash`t$($path.Replace('\', '/'))")
  }

  $fingerprint = ($manifest | & git hash-object --stdin).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $fingerprint) {
    throw 'Impossible de calculer l’empreinte finale.'
  }
  Write-Output $fingerprint
} finally {
  Pop-Location
}
