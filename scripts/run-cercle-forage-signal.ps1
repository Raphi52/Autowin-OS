# Signal du run « forage dans le cercle : couronne -> depot -> categories ».
# Rejoue ce qui prouve le livrable : les types, le modele de forage pur, l'inventaire des depots,
# la garde de cablage IPC, et l'absence de regression des invariants du layout radial.
# Sort non-zero au premier echec : c'est ce code de sortie que le stop-gate lit.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

Write-Host '== typecheck (node + web) =='
& npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : typecheck'; exit 1 }

$suites = @(
  'src/renderer/src/components/graph-drill.test.ts',
  'src/renderer/src/components/graph-radial-layout.test.ts',
  'src/main/repo-inventory.test.ts',
  'src/main/repo-inventory.wiring.test.ts'
)
Write-Host '== suites du livrable =='
& npx vitest run @suites
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : suites du livrable'; exit 1 }

Write-Host '== lint des fichiers du livrable (zero ERREUR exigee) =='
$files = @(
  'src/renderer/src/components/graph-drill.ts',
  'src/main/repo-inventory.ts'
)
& npx eslint @files
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : lint'; exit 1 }

Write-Host 'SIGNAL VERT'
exit 0
