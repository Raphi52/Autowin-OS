param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$manifest = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Projet Autowin OS introuvable : $ProjectRoot" }

$env:AUTOWIN_OS_DEV = '1'
Start-Process -FilePath $npm -ArgumentList @('run', 'dev') -WorkingDirectory $ProjectRoot -WindowStyle Hidden
