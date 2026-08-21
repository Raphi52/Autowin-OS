# Ouvre UN element Outlook dans Outlook, par son identifiant.
#
# Fichier separe du script de lecture, a dessein : lire n'est pas agir. La passerelle de lecture est
# declaree en LECTURE SEULE et doit le rester lisible d'un coup d'oeil ; y ajouter une operation qui
# ouvre une fenetre aurait dilue cette garantie. Une seule operation ici, `Display`, qui n'ecrit rien
# -- ni envoi, ni reponse, ni marquage lu.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-open.ps1 -Id <EntryID>

param(
  [Parameter(Mandatory = $true)][string]$Id
)

$ErrorActionPreference = 'Stop'

# L'identifiant d'Outlook est une chaine hexadecimale longue. On la valide AVANT de la passer a COM :
# ce parametre vient du renderer, et un canal IPC n'est pas un endroit ou faire confiance.
if ($Id -notmatch '^[0-9A-Fa-f]{16,512}$') {
  Write-Host 'ECHEC - identifiant Outlook invalide'
  exit 2
}

try {
  $outlook = New-Object -ComObject Outlook.Application
  $item = $outlook.GetNamespace('MAPI').GetItemFromID($Id)
  if ($null -eq $item) {
    Write-Host 'ECHEC - element introuvable'
    exit 3
  }
  # `Display` ouvre la fenetre d'Outlook sur l'element. Elle ne modifie pas l'element, et ne le marque
  # pas comme lu : c'est Outlook qui decidera, selon les reglages de l'utilisateur, ce qui est son
  # affaire et non la notre.
  $item.Display($false)
  # Sans cela, la fenetre s'ouvre DERRIERE Autowin et l'utilisateur croit que le clic n'a rien fait.
  try { $outlook.ActiveWindow().Activate() } catch { }
  Write-Host 'OK - element ouvert'
  exit 0
}
catch {
  Write-Host ('ECHEC - ' + $_.Exception.Message)
  exit 1
}
