# Lecture SEULE du profil Outlook local, par automation COM.
#
# Rend un instantane JSON : les derniers messages de la boite de reception et les rendez-vous d'une
# fenetre datee. Aucune ecriture, jamais : ni envoi, ni reponse, ni marquage lu.
#
# Le JSON est ecrit dans un FICHIER en UTF-8 et non sur la sortie standard. Raison mesuree : la
# sortie standard de PowerShell est rendue en cp1252 sur ce poste, et une sonde a renvoye
# "Bo?te de r?ception" -- un accent perdu la se retrouve a l'ecran de l'application.
#
# Ecrit en ASCII et avec BOM : Windows PowerShell 5.1 relit un .ps1 sans BOM en ANSI, et un accent y
# devient un jeton invalide.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/outlook-local-snapshot.ps1 -Out <fichier>

param(
  [Parameter(Mandatory = $true)][string]$Out,
  # Plafond de messages lus. Une boite volumineuse ne doit pas faire durer l'appel : on trie par date
  # AVANT de lire, donc ce plafond garde les plus recents.
  [ValidateRange(1, 2000)][int]$MaxMails = 300,
  # Fenetre volontairement LARGE : le widget montre la semaine, mais si elle est vide il annonce le
  # prochain rendez-vous au lieu d'un vide que l'utilisateur lirait comme une panne.
  [ValidateRange(1, 400)][int]$Jours = 120,
  # Decalage ARRIERE de la fenetre, en jours. Vaut 0 en usage normal : l'accueil regarde devant.
  # Existe pour le DIAGNOSTIC -- sans lui, un calendrier dont tous les rendez-vous sont passes ne
  # permet aucune preuve positive du depliage, et un chemin jamais exerce n'est pas un chemin verifie.
  [ValidateRange(0, 3650)][int]$DepuisJours = 0
)

$ErrorActionPreference = 'Stop'

function Write-Snapshot($objet) {
  $json = $objet | ConvertTo-Json -Depth 6 -Compress
  # UTF-8 SANS BOM : le cote Node lit du JSON, et un BOM en tete casse JSON.parse.
  [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  $outlook = New-Object -ComObject Outlook.Application
  $session = $outlook.GetNamespace('MAPI')

  # --- messages
  $inbox = $session.GetDefaultFolder(6)
  $items = $inbox.Items
  $items.Sort('[ReceivedTime]', $true)
  $mails = New-Object System.Collections.ArrayList
  $lus = 0
  foreach ($item in $items) {
    if ($lus -ge $MaxMails) { break }
    $lus++
    # Un element de calendrier ou une confirmation de lecture n'est pas un message : la boite peut en
    # contenir, et ils n'ont pas les memes proprietes.
    if ($item.MessageClass -notlike 'IPM.Note*') { continue }
    $adresse = ''
    try { $adresse = [string]$item.SenderEmailAddress } catch { $adresse = '' }
    $nom = ''
    try { $nom = [string]$item.SenderName } catch { $nom = '' }
    $recu = $null
    try { $recu = $item.ReceivedTime } catch { $recu = $null }
    $recuIso = $null
    if ($null -ne $recu) { $recuIso = $recu.ToString('o') }
    [void]$mails.Add([pscustomobject]@{
      id = [string]$item.EntryID
      adresse = $adresse
      nom = $nom
      sujet = [string]$item.Subject
      # ISO 8601 : le cote Node compare des instants, pas des chaines localisees.
      recuLe = $recuIso
      nonLu = [bool]$item.UnRead
      conversation = [string]$item.ConversationID
    })
  }

  # --- avec QUI l'utilisateur echange vraiment
  #
  # La boite de reception seule ne distingue pas une personne d'un automate : releve du 2026-08-21 sur
  # une vraie boite, sur 23 emetteurs, la majorite etaient des notifications (codes a usage unique,
  # ajouts a des groupes, robots de suivi). Un widget qui promet "mes echanges par interlocuteur" et
  # livre cela rate sa promesse.
  #
  # Le critere retenu n'est PAS une liste noire de domaines -- elle serait fausse le jour ou un
  # collegue ecrit depuis un domaine inattendu. C'est un fait : les adresses AUXQUELLES l'utilisateur
  # a ecrit. Un echange va dans les deux sens ; une notification, non.
  $connus = New-Object System.Collections.Generic.HashSet[string]
  try {
    $envoyes = $session.GetDefaultFolder(5).Items
    $envoyes.Sort('[SentOn]', $true)
    $vus = 0
    foreach ($envoye in $envoyes) {
      if ($vus -ge 400) { break }
      $vus++
      try {
        foreach ($destinataire in $envoye.Recipients) {
          $adresseDest = [string]$destinataire.Address
          if ($adresseDest) { [void]$connus.Add($adresseDest.ToLowerInvariant()) }
        }
      } catch { }
    }
  } catch {
    # Pas de dossier Elements envoyes accessible : on ne sait pas qui est une personne, et on le DIT
    # plutot que de deviner. Le cote application affichera alors tout sans distinction.
    $connus = $null
  }

  # --- rendez-vous
  #
  # Trois pieges d'Outlook, tous les trois mesures sur ce poste :
  #
  # 1. Le tri DOIT preceder `IncludeRecurrences`, et `IncludeRecurrences` DOIT preceder `Restrict` :
  #    dans un autre ordre, les occurrences recurrentes ne sortent pas.
  # 2. Sur une collection filtree avec recurrences, `.Count` ne veut RIEN dire : il rend 2147483647
  #    (int max) -- mesure du 2026-08-21 -- et `foreach` n'itere pas. Il faut `GetFirst`/`GetNext`.
  # 3. Le filtre exige une date au format court AMERICAIN, quelle que soit la langue d'Outlook.
  $debut = (Get-Date).Date.AddDays(-1 * $DepuisJours)
  $fin = (Get-Date).Date.AddDays($Jours)
  $rdvs = $session.GetDefaultFolder(9).Items
  $rdvs.Sort('[Start]')
  $rdvs.IncludeRecurrences = $true
  # Le filtre passe par une date au format court AMERICAIN, quelle que soit la langue d'Outlook.
  $filtre = "[Start] >= '" + $debut.ToString('MM/dd/yyyy HH:mm') + "' AND [Start] < '" + $fin.ToString('MM/dd/yyyy HH:mm') + "'"
  $filtres = $rdvs.Restrict($filtre)
  $evenements = New-Object System.Collections.ArrayList
  $rdv = $filtres.GetFirst()
  while ($null -ne $rdv -and $evenements.Count -lt 200) {
    [void]$evenements.Add([pscustomobject]@{
      id = [string]$rdv.GlobalAppointmentID
      sujet = [string]$rdv.Subject
      lieu = [string]$rdv.Location
      debut = $rdv.Start.ToString('o')
      fin = $rdv.End.ToString('o')
      journeeEntiere = [bool]$rdv.AllDayEvent
      recurrent = [bool]$rdv.IsRecurring
    })
    $rdv = $filtres.GetNext()
  }

  Write-Snapshot ([pscustomobject]@{
    ok = $true
    luLe = (Get-Date).ToString('o')
    boite = [string]$inbox.Name
    mailsNonLus = [int]$inbox.UnReadItemCount
    mails = @($mails)
    evenements = @($evenements)
    # `$null` signifie "je n'ai pas pu savoir", ce qui n'est PAS la meme chose qu'un ensemble vide.
    adressesEchangees = if ($null -eq $connus) { $null } else { @($connus) }
  })
  Write-Host ("OK - " + $mails.Count + " messages, " + $evenements.Count + " evenements")
  exit 0
}
catch {
  # L'echec est ECRIT lui aussi : le cote Node doit pouvoir distinguer "Outlook absent" de "script
  # jamais lance", et un message d'erreur perdu sur stderr en cp1252 ne le permet pas.
  Write-Snapshot ([pscustomobject]@{ ok = $false; erreur = [string]$_.Exception.Message })
  Write-Host ("ECHEC - " + $_.Exception.Message)
  exit 1
}
