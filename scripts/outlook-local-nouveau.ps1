# ENVOIE un message NEUF a une adresse, avec son objet. Ce n'est PAS une reponse.
#
# Deuxieme script Outlook de ce depot qui ECRIT, apres outlook-local-reply.ps1. Il en est SEPARE, et
# pas ajoute dedans par un parametre : `Reply()` demande un element EXISTANT et laisse Outlook
# remplir destinataire, objet et historique cite. Ici il n'y a aucun element de depart -- tout est
# fourni par l'appelant, donc tout est a valider. Melanger les deux chemins aurait fait un script ou
# la moitie des parametres est ignoree selon le mode, et c'est exactement la forme qui laisse passer
# un envoi a la mauvaise personne.
#
# Objet et corps arrivent par des FICHIERS en UTF-8, jamais en argument. Deux raisons mesurees sur ce
# poste : la console est en cp1252 (un accent passe en argument arrive abime), et un texte libre
# concatene dans une ligne de commande serait interpretable, alors qu'un fichier ne l'est jamais.
# L'adresse, elle, passe en argument : elle est contrainte a un motif ASCII strict des DEUX cotes.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
# Codes de sortie -- ils portent la CAUSE, que l'appelant traduit en phrase :
#   0 envoye | 1 echec Outlook | 2 adresse invalide | 3 fichier introuvable
#   4 corps vide | 5 objet vide | 6 destinataire non resolu par Outlook
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-nouveau.ps1 `
#     -A <adresse> -ObjetFichier <fichier> -CorpsFichier <fichier>

param(
  [Parameter(Mandatory = $true)][string]$A,
  [Parameter(Mandatory = $true)][string]$ObjetFichier,
  [Parameter(Mandatory = $true)][string]$CorpsFichier
)

$ErrorActionPreference = 'Stop'

# L'adresse vient du renderer par IPC et part dans un appel COM : elle est validee ICI AUSSI, une
# frontiere de confiance ne se garde pas d'un seul cote.
if ($A -notmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$') {
  Write-Host 'ECHEC - adresse invalide'
  exit 2
}

if (-not (Test-Path -LiteralPath $ObjetFichier) -or -not (Test-Path -LiteralPath $CorpsFichier)) {
  Write-Host 'ECHEC - fichier introuvable'
  exit 3
}

# Lus en UTF-8 EXPLICITEMENT : c'est l'encodage que Node ecrit, et le defaut de la machine ne doit
# pas s'en meler -- sinon le message partirait avec des accents casses.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$objet = [System.IO.File]::ReadAllText($ObjetFichier, $utf8)
$corps = [System.IO.File]::ReadAllText($CorpsFichier, $utf8)

# L'objet tient sur UNE ligne : un retour chariot dans un en-tete de courrier n'a pas de sens, et
# l'appelant le retire deja. Ici on le retire aussi, pour la meme raison que la validation ci-dessus.
$objet = ($objet -replace '[\r\n]+', ' ').Trim()
if ([string]::IsNullOrWhiteSpace($objet)) {
  Write-Host 'ECHEC - objet vide'
  exit 5
}
if ([string]::IsNullOrWhiteSpace($corps)) {
  Write-Host 'ECHEC - corps vide'
  exit 4
}

try {
  # Liage TARDIF, et NON `New-Object -ComObject`. Mesure de ce poste le 2026-08-31 : l'interface
  # `_Application` n'est pas enregistree, `New-Object -ComObject` reussit puis le PREMIER acces
  # membre echoue en 0x80040155. Voir le commentaire detaille dans outlook-local-snapshot.ps1.
  $typeOutlook = [Type]::GetTypeFromProgID('Outlook.Application')
  if ($null -eq $typeOutlook) { throw "Outlook n'est pas installe sur ce poste." }
  $outlook = [Activator]::CreateInstance($typeOutlook)

  # 0 = olMailItem. Un message NEUF, dans le compte par defaut du profil.
  $mail = $outlook.CreateItem(0)
  $mail.Subject = $objet
  $mail.Body = $corps

  # `Recipients.Add` plutot que `.To = ...` : la propriete `To` est une CHAINE qu'Outlook n'analyse
  # qu'a l'enregistrement, donc un destinataire refuse ne se verrait qu'apres l'envoi. Ajoute puis
  # RESOLU, on sait AVANT d'envoyer si Outlook sait a qui remettre le message.
  $destinataire = $mail.Recipients.Add($A)
  $resolu = $false
  try { $resolu = [bool]$destinataire.Resolve() } catch { $resolu = $false }
  if (-not $resolu) {
    Write-Host 'ECHEC - destinataire non resolu'
    exit 6
  }

  $mail.Send()
  Write-Host ('OK - message envoye a ' + $A)
  exit 0
}
catch {
  Write-Host ('ECHEC - ' + $_.Exception.Message)
  exit 1
}
