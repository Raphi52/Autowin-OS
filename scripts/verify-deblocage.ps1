# Signal du deblocage : les phases canoniques et le fond d'ecran de l'Accueil.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
#   powershell -NoProfile -File scripts/verify-deblocage.ps1

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$cibles = @(
  'src/main/skill-routing.phases-canoniques.test.ts',
  'src/main/intent-phase-routing.test.ts',
  'src/main/skill-invocation.test.ts',
  'src/renderer/src/components/HomeView.css.test.ts',
  'src/main/workflow-walk.juge-terminal.test.ts',
  'src/main/security-critical-fixes.test.ts'
)

Write-Host ("Signal deblocage - " + $cibles.Count + " fichiers de test")
& npx vitest run @cibles
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ("ROUGE - vitest a rendu " + $code)
  exit $code
}
Write-Host 'VERT'
exit 0
