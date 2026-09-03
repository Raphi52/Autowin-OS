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
  [ValidateRange(0, 3650)][int]$DepuisJours = 0,
  # Plafond de messages ENVOYES rapportes. Ils servent a montrer les DEUX cotes d'un fil : sans eux
  # une conversation n'a qu'une moitie, et elle se lit comme un monologue du correspondant.
  [ValidateRange(0, 1000)][int]$MaxEnvoyes = 150,
  # Longueur retenue du corps d'un message. Tronque ICI et pas cote application : le cout est dans le
  # transport, et un fil de discussion se lit sur les premiers milliers de caracteres.
  [ValidateRange(0, 20000)][int]$MaxCorps = 2000
)

$ErrorActionPreference = 'Stop'

# Le corps d'un message, tronque et sans les blancs de mise en page.
#
# Outlook rend le corps HTML converti en texte quand on lit `.Body` ; les tableaux de signature y
# laissent des rafales de lignes vides qui, dans un widget, poussent le texte utile hors de l'ecran.
function Get-Corps($item, [int]$max) {
  if ($max -le 0) { return '' }
  $texte = ''
  try { $texte = [string]$item.Body } catch { return '' }
  if ([string]::IsNullOrEmpty($texte)) { return '' }
  $texte = $texte -replace "`r`n", "`n"
  $texte = [regex]::Replace($texte, "`n{3,}", "`n`n")
  $texte = $texte.Trim()
  if ($texte.Length -gt $max) { return $texte.Substring(0, $max) }
  return $texte
}

# L'adresse SMTP d'un destinataire, et non son chemin interne Exchange.
#
# `Recipients.Address` rend souvent un DN X500 (`/o=ExchangeLabs/ou=.../cn=...`) pour un collegue.
# Cote reception, le meme contact arrive avec son adresse SMTP : sans cette resolution, le message
# envoye et le message recu se rangeraient sous DEUX interlocuteurs differents, et le fil serait
# coupe en deux. Verifie par lecture de la forme rendue -- la resolution echoue silencieusement pour
# un contact externe, ou `.Address` est deja l'adresse SMTP.
function Get-AdresseSmtp($destinataire) {
  try {
    $entree = $destinataire.AddressEntry
    if ($null -ne $entree) {
      $utilisateur = $entree.GetExchangeUser()
      if ($null -ne $utilisateur) {
        $smtp = [string]$utilisateur.PrimarySmtpAddress
        if ($smtp) { return $smtp }
      }
    }
  } catch { }
  try { return [string]$destinataire.Address } catch { return '' }
}

function Write-Snapshot($objet) {
  $json = $objet | ConvertTo-Json -Depth 6 -Compress
  # UTF-8 SANS BOM : le cote Node lit du JSON, et un BOM en tete casse JSON.parse.
  [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  # Liage TARDIF, et NON `New-Object -ComObject`. Mesure de ce poste le 2026-08-31 : l'assembly interop
  # Office est installee mais l'INTERFACE `_Application` ({00063001-0000-0000-C000-000000000046}) n'est
  # PAS enregistree. `New-Object -ComObject` reussit, puis le PREMIER acces membre echoue en
  # "Interface non enregistree (HRESULT 0x80040155)" -- alors que COM et Outlook vont parfaitement bien
  # (Outlook tournait, la classe est enregistree, le typelib 9.6 est present). L'erreur atteignait donc
  # l'ecran d'accueil sous la forme d'un cast .NET, sur les DEUX tuiles.
  #
  # Contre-intuitif et verifie : `[Activator]::CreateInstance` rend le MEME type
  # (`Microsoft.Office.Interop.Outlook.ApplicationClass`) -- ce n'est pas le type qui change, c'est la
  # facon dont PowerShell lie l'appel, qui ne passe plus par le cast vers `_Application`. Tout l'aval de
  # ce script reste donc inchange, en notation pointee : mesure sur ce poste, 21986 messages et 110
  # rendez-vous lus. Ne pas "simplifier" ces trois lignes en `New-Object` : ce serait la panne de retour.
  $typeOutlook = [Type]::GetTypeFromProgID('Outlook.Application')
  if ($null -eq $typeOutlook) { throw "Outlook n'est pas installe sur ce poste." }
  $outlook = [Activator]::CreateInstance($typeOutlook)
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
      # Mesure de ce poste le 2026-09-03 : sur 40 messages lus, `ConversationID` est VIDE pour les 40,
      # alors que `ConversationTopic` est renseigne et vaut l'objet debarrasse de ses "RE:" / "TR:".
      # Les deux sont donc rapportes tels quels ; c'est le modele, cote application, qui choisit la
      # cle -- l'identifiant s'il existe, le sujet de conversation sinon. Ne pas retirer ce champ :
      # sans lui, aucun fil ne se regroupe sur ce profil.
      sujetConversation = [string]$item.ConversationTopic
      corps = (Get-Corps $item $MaxCorps)
      deMoi = $false
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
    $mailsEnvoyes = 0
    foreach ($envoye in $envoyes) {
      if ($vus -ge 400) { break }
      $vus++
      $premiereAdresse = ''
      $premierNom = ''
      try {
        foreach ($destinataire in $envoye.Recipients) {
          $adresseDest = Get-AdresseSmtp $destinataire
          if ($adresseDest) {
            [void]$connus.Add($adresseDest.ToLowerInvariant())
            if (-not $premiereAdresse) {
              $premiereAdresse = $adresseDest
              try { $premierNom = [string]$destinataire.Name } catch { $premierNom = '' }
            }
          }
        }
      } catch { }

      # Le message ENVOYE rejoint la liste, range sous son DESTINATAIRE et non sous son expediteur :
      # c'est ainsi qu'il retombe dans le fil du bon interlocuteur cote application. Un envoi n'est
      # jamais "non lu" -- il vient de nous.
      if ($mailsEnvoyes -lt $MaxEnvoyes -and $premiereAdresse -and $envoye.MessageClass -like 'IPM.Note*') {
        $envoiIso = $null
        try { $envoiIso = $envoye.SentOn.ToString('o') } catch { $envoiIso = $null }
        [void]$mails.Add([pscustomobject]@{
          id = [string]$envoye.EntryID
          adresse = $premiereAdresse
          nom = $premierNom
          sujet = [string]$envoye.Subject
          recuLe = $envoiIso
          nonLu = $false
          conversation = [string]$envoye.ConversationID
          sujetConversation = [string]$envoye.ConversationTopic
          corps = (Get-Corps $envoye $MaxCorps)
          deMoi = $true
        })
        $mailsEnvoyes++
      }
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
