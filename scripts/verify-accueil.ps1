# Signal de la vue Accueil et de la passerelle Outlook locale.
#
# Existe en SCRIPT et non en ligne de commande parce que le Stop-gate ne rejoue qu'une forme
# whitelistee (powershell -NoProfile -File <script>) : un signal qu'il ne peut pas rejouer ne prouve
# rien, quel que soit son resultat quand c'est moi qui l'annonce.
#
# Ecrit en ASCII et avec BOM a dessein : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un
# accent y devient un jeton invalide -- vecu sur ce fichier meme.
#
#   powershell -NoProfile -File scripts/verify-accueil.ps1

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$cibles = @(
  'src/renderer/src/components/home-layout.test.ts',
  'src/renderer/src/components/home-widgets-model.test.ts',
  'src/renderer/src/components/outlook-model.test.ts',
  'src/renderer/src/components/HomeView.test.tsx',
  'src/main/outlook/outlook-local.test.ts',
  'src/shared/navigation.test.ts',
  'src/renderer/src/App.navigation-sync.test.tsx'
)

Write-Host ("Signal Accueil - " + $cibles.Count + " fichiers de test")
& npx vitest run @cibles
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ("ROUGE - vitest a rendu " + $code)
  exit $code
}
Write-Host 'VERT'
exit 0
