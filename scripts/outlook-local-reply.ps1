# REPOND a un element Outlook, et ENVOIE la reponse.
#
# Le seul script Outlook de ce depot qui ECRIT. Il est SEPARE du script d'instantane, comme le script
# d'ouverture : la garantie "lecture seule" de la lecture doit rester verifiable en lisant son
# fichier, sans avoir a suivre une branche. Ici, a l'inverse, tout est assume : on cree un brouillon
# de reponse et on l'envoie. C'est irreversible, et l'appelant doit l'avoir confirme.
#
# Le corps arrive par un FICHIER en UTF-8, jamais en argument. Deux raisons mesurees sur ce poste :
# la console est en cp1252 (un accent passe en argument arrive abime), et un texte libre concatene
# dans une ligne de commande serait interpretable, alors qu'un fichier ne l'est jamais.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
# Les PIECES JOINTES arrivent par un fichier qui LISTE leurs chemins, un par ligne, en UTF-8.
# Demande de l'utilisateur du 2026-09-09 : "ca marche bien pour les nouveaux fils de message, il
# faudrait aussi que ca marche pour les messages de reponse". `Attachments.Add` prend le nom du
# fichier pour nom de piece, donc l'appelant ecrit chaque piece dans son propre sous-dossier sous
# son vrai nom -- ce script ne renomme rien. Le parametre est OPTIONNEL : une reponse sans piece
# part exactement comme avant.
#
# Codes de sortie -- ils portent la CAUSE, que l'appelant traduit en phrase :
#   0 envoye | 1 echec Outlook | 2 identifiant invalide | 3 element ou fichier introuvable
#   4 corps vide | 5 aucun destinataire trouve | 7 piece jointe refusee par Outlook
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-reply.ps1 -Id <EntryID> -CorpsFichier <fichier> [-PiecesFichier <fichier>]

param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$CorpsFichier,
  [Parameter(Mandatory = $false)][string]$PiecesFichier
)

$ErrorActionPreference = 'Stop'

# L'identifiant vient du renderer par IPC. Il est valide des DEUX cotes : une frontiere de confiance
# ne se garde pas d'un seul cote, et celui-ci part directement dans un appel COM.
if ($Id -notmatch '^[0-9A-Fa-f]{16,512}$') {
  Write-Host 'ECHEC - identifiant Outlook invalide'
  exit 2
}

if (-not (Test-Path -LiteralPath $CorpsFichier)) {
  Write-Host 'ECHEC - fichier de corps introuvable'
  exit 4
}

# Lu en UTF-8 EXPLICITEMENT : c'est l'encodage que Node ecrit, et le defaut de la machine ne doit
# pas s'en meler -- sinon la reponse partirait avec des accents casses.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$corps = [System.IO.File]::ReadAllText($CorpsFichier, $utf8)
if ([string]::IsNullOrWhiteSpace($corps)) {
  Write-Host 'ECHEC - corps vide'
  exit 4
}

# Les chemins des pieces jointes, lus AVANT d'ouvrir Outlook : un chemin manquant doit se dire sans
# avoir cree un brouillon de reponse. Chaque ligne est un chemin absolu ecrit par l'appelant.
$pieces = @()
if (-not [string]::IsNullOrWhiteSpace($PiecesFichier)) {
  if (-not (Test-Path -LiteralPath $PiecesFichier)) {
    Write-Host 'ECHEC - fichier introuvable'
    exit 3
  }
  foreach ($ligne in [System.IO.File]::ReadAllLines($PiecesFichier, $utf8)) {
    $chemin = $ligne.Trim()
    if ([string]::IsNullOrWhiteSpace($chemin)) { continue }
    if (-not (Test-Path -LiteralPath $chemin)) {
      Write-Host ('ECHEC - fichier introuvable : ' + $chemin)
      exit 3
    }
    $pieces += $chemin
  }
}

try {
  # Liage TARDIF, et NON `New-Object -ComObject`. Mesure de ce poste le 2026-08-31 : l'interface
  # `_Application` n'est pas enregistree, `New-Object -ComObject` reussit puis le PREMIER acces
  # membre echoue en 0x80040155. Voir le commentaire detaille dans outlook-local-snapshot.ps1.
  $typeOutlook = [Type]::GetTypeFromProgID('Outlook.Application')
  if ($null -eq $typeOutlook) { throw "Outlook n'est pas installe sur ce poste." }
  $outlook = [Activator]::CreateInstance($typeOutlook)
  $item = $outlook.GetNamespace('MAPI').GetItemFromID($Id)
  if ($null -eq $item) {
    Write-Host 'ECHEC - element introuvable'
    exit 3
  }

  # `Reply()` cree un BROUILLON : c'est Outlook qui remplit le destinataire, l'objet ("RE: ...") et
  # l'historique cite. Fabriquer un mail neuf a la main perdrait le fil de discussion cote
  # destinataire, et c'est precisement ce fil que le widget affiche.
  $reponse = $item.Reply()

  # Garde-fou : si Outlook n'a su adresser la reponse a personne (element de la boite d'envoi, contact
  # sans adresse), on n'envoie RIEN. Un message parti nulle part se lirait comme un message envoye.
  $destinataires = 0
  try { $destinataires = [int]$reponse.Recipients.Count } catch { $destinataires = 0 }
  if ($destinataires -lt 1) {
    Write-Host 'ECHEC - aucun destinataire'
    exit 5
  }

  # Les PIECES JOINTES avant tout envoi : une piece ajoutee apres `.Send()` n'arriverait jamais, et
  # un refus doit porter sa propre cause -- "Outlook n'a pas pu envoyer cette reponse" ferait
  # chercher l'erreur du cote du texte.
  foreach ($chemin in $pieces) {
    try { [void]$reponse.Attachments.Add($chemin) }
    catch {
      Write-Host ('ECHEC - piece jointe refusee : ' + $chemin)
      exit 7
    }
  }

  # Le texte de l'utilisateur AU-DESSUS, l'historique cite d'Outlook en dessous : c'est la convention
  # de toutes les messageries, et l'inverse enterrerait la reponse sous la citation.
  $reponse.Body = $corps + "`r`n`r`n" + [string]$reponse.Body
  $reponse.Send()

  Write-Host ('OK - reponse envoyee a ' + $destinataires + ' destinataire(s)')
  exit 0
}
catch {
  Write-Host ('ECHEC - ' + $_.Exception.Message)
  exit 1
}
