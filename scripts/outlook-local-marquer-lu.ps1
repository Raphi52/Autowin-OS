# MARQUE des messages Outlook comme LUS, par leurs identifiants.
#
# Le deuxieme script de ce depot qui ECRIT dans la boite (avec la reponse). Il est SEPARE du script
# d'instantane pour la meme raison : la garantie "lecture seule" de la lecture doit rester
# verifiable en lisant son fichier, sans avoir a suivre une branche.
#
# Les identifiants arrivent par un FICHIER, un par ligne, jamais en argument. Un fil peut en compter
# des dizaines : une ligne de commande a une longueur maximale, et un identifiant Outlook fait
# jusqu'a 512 caracteres. Un fichier n'a pas cette limite et n'est jamais interprete.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
# Codes de sortie -- ils portent la CAUSE, que l'appelant traduit en phrase :
#   0 marques (ou deja lus) | 1 echec Outlook | 2 aucun identifiant utilisable
#   3 aucun de ces elements n'existe plus dans Outlook
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-marquer-lu.ps1 -IdsFichier <fichier>

param(
  [Parameter(Mandatory = $true)][string]$IdsFichier
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $IdsFichier)) {
  Write-Host 'ECHEC - fichier d identifiants introuvable'
  exit 2
}

# Lu en UTF-8 EXPLICITEMENT, comme le corps d'une reponse : c'est ce que Node ecrit, et le defaut de
# la machine ne doit pas s'en meler.
$lignes = [System.IO.File]::ReadAllLines($IdsFichier, (New-Object System.Text.UTF8Encoding($false)))

# Chaque identifiant est valide ICI AUSSI, et pas seulement cote application : il vient du renderer
# par IPC et part dans un appel COM. Une frontiere de confiance ne se garde pas d'un seul cote.
$ids = @()
foreach ($ligne in $lignes) {
  $propre = ([string]$ligne).Trim()
  if ($propre -match '^[0-9A-Fa-f]{16,512}$') { $ids += $propre }
}

if ($ids.Count -lt 1) {
  Write-Host 'ECHEC - aucun identifiant valide'
  exit 2
}

try {
  # Liage TARDIF, et NON `New-Object -ComObject`. Mesure de ce poste le 2026-08-31 : l'interface
  # `_Application` n'est pas enregistree, `New-Object -ComObject` reussit puis le PREMIER acces
  # membre echoue en 0x80040155. Voir le commentaire detaille dans outlook-local-snapshot.ps1.
  $typeOutlook = [Type]::GetTypeFromProgID('Outlook.Application')
  if ($null -eq $typeOutlook) { throw "Outlook n'est pas installe sur ce poste." }
  $outlook = [Activator]::CreateInstance($typeOutlook)
  $session = $outlook.GetNamespace('MAPI')

  $marques = 0
  $trouves = 0
  foreach ($id in $ids) {
    $item = $null
    # Un element supprime ou deplace entre la lecture et le clic fait echouer `GetItemFromID`. Ce
    # n'est PAS un echec de l'operation : les autres messages du fil doivent quand meme etre marques.
    try { $item = $session.GetItemFromID($id) } catch { $item = $null }
    if ($null -eq $item) { continue }
    $trouves++
    $deja = $false
    try { $deja = -not [bool]$item.UnRead } catch { $deja = $false }
    if ($deja) { continue }
    $item.UnRead = $false
    # `Save()` est ce qui ECRIT dans la boite. Sans lui, le drapeau retombe des que l'objet COM est
    # libere, et la pastille reapparait a la lecture suivante -- exactement le defaut a corriger.
    $item.Save()
    $marques++
  }

  if ($trouves -lt 1) {
    Write-Host 'ECHEC - aucun de ces elements n existe encore'
    exit 3
  }

  Write-Host ('OK - ' + $marques + ' message(s) marque(s) lu(s) sur ' + $trouves + ' trouve(s)')
  exit 0
}
catch {
  Write-Host ('ECHEC - ' + $_.Exception.Message)
  exit 1
}
