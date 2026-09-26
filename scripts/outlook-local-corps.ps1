# Lecture SEULE du texte ENTIER d'un seul message Outlook, par son identifiant.
#
# Pourquoi ce script existe : l'instantane (`outlook-local-snapshot.ps1`) coupe chaque corps a 800
# caracteres, pour le cout de la tuile d'accueil. Mesure du 2026-09-26 : 54 mails sur 80 coupes pile
# a 800. La regle "Assistant mails" ne donnait donc a l'agent que le debut du mail auquel il devait
# repondre. Elle relit ici CE SEUL message, une fois, au moment ou il declenche.
#
# Aucune ecriture, jamais : ni envoi, ni reponse, ni marquage lu. Seule lecture : `.Body`.
#
# Le JSON est ecrit dans un FICHIER en UTF-8 sans BOM, comme l'instantane : la sortie standard de
# PowerShell est en cp1252 sur ce poste, et un accent y serait perdu.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-corps.ps1 -Id <EntryID> -Out <fichier>

param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$Out,
  # 8000 : la borne de `describeMail`, au-dela de laquelle l'agent ne lirait de toute facon pas.
  [ValidateRange(1, 20000)][int]$MaxCorps = 8000
)

$ErrorActionPreference = 'Stop'

function Write-Resultat($objet) {
  $json = $objet | ConvertTo-Json -Depth 3 -Compress
  # UTF-8 SANS BOM : le cote Node lit du JSON, et un BOM en tete casse JSON.parse.
  [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# L'identifiant vient d'un instantane, mais il part dans un appel COM : il est valide ici aussi.
if ($Id -notmatch '^[0-9A-Fa-f]{16,512}$') {
  Write-Resultat ([pscustomobject]@{ ok = $false; erreur = "Cet identifiant n'a pas la forme d'un element Outlook." })
  exit 2
}

try {
  # Liage TARDIF, comme l'instantane : `New-Object -ComObject` echoue au premier acces membre sur ce
  # poste (interface `_Application` non enregistree, HRESULT 0x80040155, mesure 2026-08-31).
  $typeOutlook = [Type]::GetTypeFromProgID('Outlook.Application')
  if ($null -eq $typeOutlook) { throw "Outlook n'est pas installe sur ce poste." }
  $outlook = [Activator]::CreateInstance($typeOutlook)
  $item = $outlook.GetNamespace('MAPI').GetItemFromID($Id)
  if ($null -eq $item) {
    Write-Resultat ([pscustomobject]@{ ok = $false; erreur = 'Ce message n existe plus dans Outlook.' })
    exit 3
  }
  # Meme mise en forme que l'instantane (Get-Corps) : fins de ligne unifiees, rafales de lignes vides
  # des signatures ramenees a une seule ligne vide. Seule la longueur change.
  $texte = [string]$item.Body
  if ($null -eq $texte) { $texte = '' }
  $texte = $texte -replace "`r`n", "`n"
  $texte = [regex]::Replace($texte, "`n{3,}", "`n`n")
  $texte = $texte.Trim()
  if ($texte.Length -gt $MaxCorps) { $texte = $texte.Substring(0, $MaxCorps) }
  Write-Resultat ([pscustomobject]@{ ok = $true; corps = $texte })
  Write-Host ('OK - ' + $texte.Length + ' caracteres')
  exit 0
}
catch {
  Write-Resultat ([pscustomobject]@{ ok = $false; erreur = [string]$_.Exception.Message })
  Write-Host ('ECHEC - ' + $_.Exception.Message)
  exit 1
}
