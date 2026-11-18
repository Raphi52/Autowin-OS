<#
  AVERTISSEMENTS DE GESTE de scripts/hdesk-act.ps1 (dot-source), a part pour etre testes seuls
  (src/main/bureau/hdesk-act-avertissements.test.ts).

  Pourquoi : un clic suivi de fleches dans le MEME geste (-X -Y -Touches "28,0D") ouvre une liste
  deroulante ou un menu et le referme avant toute capture. La valeur change, la capture suivante
  montre le champ ferme, et l'agent conclut « liste testee » sans avoir jamais vu ses lignes.
  Constate le 18/11/2026 : liste des themes d'une app WebView2, lignes en texte clair sur une liste
  blanche, illisibles ; c'est l'utilisateur qui l'a decouvert en l'ouvrant.
  Avertissement et non refus : cliquer dans un champ puis appuyer sur Bas reste un geste licite.
#>

# Touches qui CHOISISSENT une ligne d'une liste ouverte : fleches haut/bas, page haut/bas.
# Codes virtuels en hexadecimal, eventuellement repetes (« 28x15 »).
$toucheDeNavigationHex = @('26', '28', '21', '22')
$toucheDeNavigationNommee = @('Haut', 'Bas', 'PageHaut', 'PageBas')

$avertissementListeFermee =
  'Clic et fleches dans le meme geste : si ce clic a ouvert une liste ou un menu, il s''est referme ' +
  'avant ta capture, et tu n''as pas vu ses lignes. Pour le prouver : clic SEUL, capture de la liste ' +
  'OUVERTE (lignes lisibles ?), puis choix par un clic sur la ligne, ou -SansClic -Touches.'

function Test-ClicPuisNavigation {
  param([string]$Touches = '', [string]$Touche = '')
  if ($toucheDeNavigationNommee -contains $Touche.Trim()) { return $true }
  foreach ($morceau in ($Touches -split ',')) {
    $code = ($morceau.Trim() -split 'x')[0].Trim().ToUpperInvariant()
    if ($toucheDeNavigationHex -contains $code) { return $true }
  }
  return $false
}
