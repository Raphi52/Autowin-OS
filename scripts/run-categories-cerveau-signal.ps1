# Signal du run « catégories cognitives comme premier anneau ».
# Rejoue ce qui prouve le livrable : les types, la règle de rattachement et sa précédence, la
# partition, l'absence d'heuristique de contenu, et la non-régression de l'arbre et des vues
# existantes. Sort non-zero au premier echec.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

Write-Host '== typecheck (node + web) =='
& npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : typecheck'; exit 1 }

$suites = @(
  'src/renderer/src/components/graph-brain-categories.test.ts',
  'src/renderer/src/components/graph-tree-layout.test.ts',
  'src/renderer/src/components/graph-radial-layout.test.ts',
  'src/renderer/src/components/graph-drill.test.ts',
  'src/renderer/src/components/graph-settings.test.ts'
)
Write-Host '== rattachement + arbre + non-regression des vues existantes =='
& npx vitest run @suites
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : suites'; exit 1 }

Write-Host '== lint des fichiers du livrable (zero ERREUR exigee) =='
& npx eslint 'src/renderer/src/components/graph-brain-categories.ts' 'src/renderer/src/components/graph-tree-layout.ts'
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : lint'; exit 1 }

Write-Host 'SIGNAL VERT'
exit 0
