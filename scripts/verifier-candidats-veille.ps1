# Signal de la veille : chaque citation est rejouee contre sa page, ET le verificateur prouve qu'il
# peut echouer.
#
# Deux passages, dans cet ordre, parce que l'ordre porte l'argument :
#   1. controle NEGATIF — une citation fabriquee doit etre rejetee. Sans lui, un verificateur qui
#      valide tout ressemble exactement a un verificateur qui marche.
#   2. verification REELLE du stock.
#
# Le code de sortie du script est celui du premier passage en echec : le gate rejoue cette commande, il
# ne doit jamais lire un vert qui vient d'un controle absent.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

Write-Host '--- controle negatif (le verificateur doit rejeter une citation fabriquee) ---'
& npx tsx scripts/verifier-candidats-veille.ts --controle-negatif
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Le controle negatif a echoue : on ne peut rien conclure du reste.'
  exit $LASTEXITCODE
}

Write-Host ''
Write-Host '--- verification du stock reel ---'
& npx tsx scripts/verifier-candidats-veille.ts @args
exit $LASTEXITCODE
