# Signal du run « le cercle devient une arborescence ».
# Rejoue ce qui prouve le livrable : les types, les invariants de l'arbre (profondeur, connexité,
# partition, non-recouvrement), le choix des étiquettes, et l'absence de régression du layout radial
# existant et du forage qui en dépend.
# Sort non-zero au premier echec : c'est ce code de sortie que le stop-gate lit.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

Write-Host '== typecheck (node + web) =='
& npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : typecheck'; exit 1 }

$suites = @(
  'src/renderer/src/components/graph-tree-layout.test.ts',
  'src/renderer/src/components/graph-radial-layout.test.ts',
  'src/renderer/src/components/graph-drill.test.ts',
  'src/renderer/src/components/graph-settings.test.ts'
)
Write-Host '== invariants de l''arbre + non-regression des vues existantes =='
& npx vitest run @suites
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : suites'; exit 1 }

Write-Host '== lint des fichiers du livrable (zero ERREUR exigee) =='
& npx eslint 'src/renderer/src/components/graph-tree-layout.ts'
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : lint'; exit 1 }

Write-Host 'SIGNAL VERT'
exit 0
