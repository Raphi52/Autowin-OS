# Signal rejouable : toute action en erreur est captee EN COURS de tour et corrigee avant la fin.
#
# Forme imposee par le Stop-gate : un fichier .ps1 lance par `powershell -NoProfile -File`, donc
# rejouable tel quel. Un `npx vitest` passe en -Command n'est pas rejoue correctement sous cmd.exe.
#
# ASCII + BOM : Windows PowerShell 5.1 lit un fichier sans BOM comme de l'ANSI, et un accent devient
# alors un token invalide.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$cibles = @(
  'src/main/erreur-captee-en-cours-de-tour.test.ts',
  'src/main/chat-turn-messages.test.ts',
  'src/main/agent-pilot.correction-apres-echec.test.ts',
  'src/main/agent-pilot.murs-persistants.test.ts',
  'src/main/annulation-motivee.test.ts'
)

& npx vitest run @cibles --reporter=dot
if ($LASTEXITCODE -ne 0) {
  Write-Host "ROUGE : le filet des erreurs captees en cours de tour ne tient plus."
  exit $LASTEXITCODE
}
Write-Host "VERT : un echec non repare relance avec droit d'agir, et une negation ne desarme plus l'aveu."
exit 0
