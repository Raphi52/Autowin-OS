# ENREGISTRE UNE piece jointe RECUE dans un dossier temporaire, pour que l'application l'ouvre.
#
# Demande du 2026-10-28 (conv-1220) : " rends les pieces jointes recues cliquables dans le widget
# Interlocuteurs : un clic sur le nom ouvre le fichier, en le recuperant depuis Outlook ". Jusque-la,
# l'instantane ne rapportait que le nom et la taille, et la tuile renvoyait a " Ouvrir dans Outlook ".
#
# Ce script N'OUVRE RIEN : il copie la piece sur le disque, et c'est l'application qui decide de
# l'ouvrir (refus des types qui lancent un programme, cote outlook-local.ts). Garder l'ouverture
# hors d'ici laisse la seule decision sensible a un seul endroit, teste.
# Aucune ecriture dans la boite : ni envoi, ni marquage lu. Seule operation : `SaveAsFile`.
#
# Le nom attendu et le chemin de destination arrivent par un FICHIER UTF-8, jamais en argument : la
# console de ce poste est en cp1252, et un nom accentue (" CR reunion ... signe.pdf ") y arriverait
# abime -- la comparaison au vrai nom echouerait, ou le fichier serait ecrit sous un autre nom.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
# Codes de sortie -- ils portent la CAUSE, que l'appelant traduit en phrase :
#   0 enregistree | 1 echec Outlook | 2 arguments inutilisables | 3 message introuvable
#   4 piece introuvable dans ce message
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-piece.ps1 -Id <EntryID> -Rang <n> -CheminsFichier <fichier>

param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][ValidateRange(1, 50)][int]$Rang,
  [Parameter(Mandatory = $true)][string]$CheminsFichier
)

$ErrorActionPreference = 'Stop'

# L'identifiant vient du renderer par IPC et part dans un appel COM : il est valide ICI AUSSI.
if ($Id -notmatch '^[0-9A-Fa-f]{16,512}$') {
  Write-Host 'ECHEC - identifiant Outlook invalide'
  exit 2
}
if (-not (Test-Path -LiteralPath $CheminsFichier)) {
  Write-Host 'ECHEC - fichier des chemins introuvable'
  exit 2
}

# Ligne 1 : le nom de la piece tel que l'instantane l'a rapporte. Ligne 2 : le chemin ou l'ecrire.
$lignes = [System.IO.File]::ReadAllLines($CheminsFichier, (New-Object System.Text.UTF8Encoding($false)))
if ($lignes.Count -lt 2) {
  Write-Host 'ECHEC - fichier des chemins incomplet'
  exit 2
}
$nomAttendu = ([string]$lignes[0]).Trim()
$destination = ([string]$lignes[1]).Trim()
if ($nomAttendu -eq '' -or $destination -eq '') {
  Write-Host 'ECHEC - nom ou destination vide'
  exit 2
}

try {
  # Liage TARDIF, et NON `New-Object -ComObject` : sur ce poste l'interface `_Application` n'est pas
  # enregistree, et le premier acces membre echoue en 0x80040155 (mesure 2026-08-31).
  $typeOutlook = [Type]::GetTypeFromProgID('Outlook.Application')
  if ($null -eq $typeOutlook) { throw "Outlook n'est pas installe sur ce poste." }
  $outlook = [Activator]::CreateInstance($typeOutlook)
  $item = $null
  try { $item = $outlook.GetNamespace('MAPI').GetItemFromID($Id) } catch { $item = $null }
  if ($null -eq $item) {
    Write-Host 'ECHEC - message introuvable'
    exit 3
  }

  $pieces = $item.Attachments
  $total = [int]$pieces.Count
  $choisie = $null
  # Le RANG d'abord, mais seulement s'il designe bien la piece NOMMEE : le rang distingue deux pieces
  # de meme nom, le nom garantit qu'on n'ouvre pas une AUTRE piece que celle sur laquelle on a clique.
  if ($Rang -le $total) {
    $candidate = $pieces.Item($Rang)
    if ([string]$candidate.FileName -eq $nomAttendu) { $choisie = $candidate }
  }
  # Repli par le nom seul : un instantane plus ancien que ce script ne portait pas de rang.
  if ($null -eq $choisie) {
    for ($i = 1; $i -le $total; $i++) {
      $candidate = $pieces.Item($i)
      if ([string]$candidate.FileName -eq $nomAttendu) { $choisie = $candidate; break }
    }
  }
  if ($null -eq $choisie) {
    Write-Host 'ECHEC - piece introuvable dans ce message'
    exit 4
  }

  $choisie.SaveAsFile($destination)

  # La MARQUE DU WEB (zone Internet), comme un navigateur pour un telechargement : sans elle, Word
  # ou Excel ouvriraient une piece recue SANS le mode protege qu'Outlook leur impose quand on ouvre
  # la meme piece depuis Outlook. Un disque sans flux alternatifs (FAT, reseau) la refuse : la piece
  # reste ouvrable, on ne perd que cette protection en plus.
  try {
    Set-Content -LiteralPath $destination -Stream 'Zone.Identifier' -Value "[ZoneTransfer]`r`nZoneId=3" -Encoding Ascii
  } catch { }

  Write-Host 'OK - piece enregistree'
  exit 0
}
catch {
  Write-Host ('ECHEC - ' + $_.Exception.Message)
  exit 1
}
