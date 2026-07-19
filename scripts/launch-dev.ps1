param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$electron = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'
$main = Join-Path $ProjectRoot 'out\main\index.js'
if (-not (Test-Path -LiteralPath $electron -PathType Leaf) -or -not (Test-Path -LiteralPath $main -PathType Leaf)) {
  throw 'Version Dev introuvable. Lance d''abord npm run build.'
}

$env:AUTOWIN_OS_DEV = '1'
Start-Process -FilePath $electron -ArgumentList 'out\main\index.js' -WorkingDirectory $ProjectRoot
