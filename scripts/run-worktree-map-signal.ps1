# Signal du run « vue Worktrees — plan de metro ».
# Rejoue exactement ce qui prouve le livrable : les types, la geometrie pure, le rendu, la
# conformite visuelle aux jetons de l'app, et la garde anti-residu de l'ancienne vue.
# Sort non-zero au premier echec : c'est ce code de sortie que le stop-gate lit.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

Write-Host '== typecheck (node + web) =='
& npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : typecheck'; exit 1 }

$suites = @(
  'src/shared/worktree-map.test.ts',
  'src/renderer/src/components/WorktreeMapView.test.tsx',
  'src/renderer/src/components/WorktreeMapView.style.test.ts',
  'src/renderer/src/frontend-cleanup.test.ts',
  'src/renderer/src/App.navigation-sync.test.tsx'
)
Write-Host '== suites du livrable =='
& npx vitest run @suites
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : suites du livrable'; exit 1 }

Write-Host '== lint des fichiers du livrable (zero ERREUR exigee) =='
$files = @(
  'src/shared/worktree-map.ts',
  'src/main/worktree-map-main.ts',
  'src/renderer/src/components/WorktreeMapView.tsx',
  'src/renderer/src/components/WorktreeMapView.css'
)
& npx eslint --max-warnings=-1 @files
if ($LASTEXITCODE -ne 0) { Write-Host 'ECHEC : lint'; exit 1 }

Write-Host 'SIGNAL VERT'
exit 0
