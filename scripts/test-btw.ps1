# Signal-cmd : commande /btw + bouton btw (parseBtw pur + modèle Chat).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& npx vitest run src/renderer/src/components/fanout-grouping
exit $LASTEXITCODE
