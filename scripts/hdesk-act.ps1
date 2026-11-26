<#
  CLIQUER ET TAPER DANS UN BUREAU WINDOWS CACHE (HDESK), sans toucher a l'ecran de l'utilisateur.
  Complete hdesk-lancer.ps1 (lancer) et hdesk-observe.ps1 (voir) : meme bureau AutowinTest_<id>.

  Pourquoi (kaizen conv-854, tour 78a0d7d3-6a84-4d86-a3a7-fd1b5cc1393f, saisie ts 1790278416518) :
  pour saisir un code de connexion, l'agent a clique dans la barre des taches de l'ecran REEL, faute
  de tout moyen d'agir dans le bureau cache. L'utilisateur a arrete le tour et demande que ce genre
  de tache se fasse dans le bureau cache.

  Usage : powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -X 400 -Y 300 [-Texte "CODE"] [-Entree]
          powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -Element '@k3f9a2:e8'
          powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -Element '@k3f9a2:e4' -Remplir -TexteEntree  (texte sur stdin)
          powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -SansClic -Touche Entree  (vers le focus clavier)
  Clique en (X,Y) (coordonnees de la capture hdesk-observe), puis tape -Texte dans la fenetre visee.
  -SansClic sans -X/-Y : la frappe part vers le controle qui a le focus clavier (banc : hdesk-act.sansclic.test.ps1).
  Limite : messages fenetre (PostMessage), pas SendInput — une app qui lit le clavier brut peut les ignorer ;
  verifier par une capture hdesk-observe apres coup.
  Mesure 2026-09-24 (Brave 154, --disable-gpu) : clic + frappe RECUS par Brave (barre d'adresse = "about:blankCXC8M5FC5",
  Audit/hact/brave2-apres.png). MAIS le contenu web s'affiche uni (blanc/noir) dans la capture du bureau cache :
  on ne peut pas VOIR un formulaire de page ; seule l'interface native du navigateur (barre d'adresse) est lisible.
  Mesure 2026-09-24 (champ de FORMULAIRE web) : page locale Audit/hact/device.html (input autofocus, oninput -> document.title)
  ouverte en --app dans le bureau cache ; clic (400,300) + frappe CXC8M5FC5 -> titre de fenetre lu via EnumDesktopWindows
  = "SAISI:CXC8M5FC5" (Audit/hact/titres.ps1). La frappe atteint donc un champ web ; pour VERIFIER sans capture, lire le titre.

  APPUI PAR ELEMENT (2026-11-08, repris de vercel-labs/agent-desktop) :
   - -Element accepte un REPERE « @<lecture>:e<n> » de hdesk-arbre.ps1 : refuse (code PERIME) si l'element
     a disparu ou change depuis la lecture, au lieu d'appuyer sur un autre.
   - Apres le geste, l'element et les fenetres sont relus jusqu'a un changement (au plus -AttenteMs) :
     la sortie porte `apres` {changement, attenteMs, element, fenetres}.
   - Un refus commence par son code entre crochets ([PERIME], [AMBIGU]...) suivi d'une ligne « Reessai : ».
   - -TexteEntree lit le texte sur l'entree standard : il ne passe plus par la ligne de commande, que
     tout processus du poste peut lire.

  GESTE ARRIVE, REFAISABLE (2026-11-26, repris de la disposition des erreurs de vercel-labs/agent-desktop :
  not_delivered / delivery_uncertain, retry safe, https://agent-browser.dev/desktop/configuration) :
  « aucun changement visible » poussait a refaire un geste deja parti, donc a envoyer un formulaire deux
  fois. Chaque sortie, reussie ou refusee, porte maintenant sur stdout :
   - `arrive` : « oui » = le geste a atteint l'application (appel d'accessibilite abouti, ou messages postes
     a la fenetre `cible`) ; son EFFET se lit dans `apres` ou sur une capture. « non » = refuse avant tout
     envoi. « incertain » = coupe en route (l'appel d'accessibilite a leve) : il a pu porter.
   - `refaisable` : le refaire a l'identique ne peut rien doubler. Vrai si rien n'est parti, ou pour un
     geste qui pose un etat (remplir un champ, selectionner une ligne) ; faux pour un appui, une bascule,
     un clic, une frappe, une touche ou la molette.
  Un refus sort en code 1 avec son message sur stderr ET cette ligne JSON {instanceId, arrive, refaisable}.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  # X/Y OU -Element (conv-1457) : l'un des deux est exige plus bas, avec un message clair.
  [int]$X = -1,
  [int]$Y = -1,
  # Appuyer sur un ELEMENT de l'arbre d'accessibilite (repere, identifiant, nom ou libelle,
  # voir hdesk-arbre.cs) au lieu d'un point. Element WPF : motif d'accessibilite ; sinon clic au centre.
  # Un seul appui : ni frappe, ni touche, ni molette avec lui ; -Remplir remplit le champ avec le texte.
  [string]$Element = '',
  [switch]$Remplir,
  # Attente maximale d'un changement visible apres un geste sur un element (0 = pas de relecture).
  [ValidateRange(0, 5000)][int]$AttenteMs = 1000,
  # Origine de la capture recadree que l'agent regarde : les positions citees dans les refus sont
  # alors en pixels de SON image.
  [ValidateRange(0, 32767)][int]$OrigineX = 0,
  [ValidateRange(0, 32767)][int]$OrigineY = 0,
  [string]$Texte = '',
  # Le texte (frappe ou remplissage) arrive sur l'entree standard, en UTF-8.
  [switch]$TexteEntree,
  [switch]$Entree,
  # conv-35 : touche nommee (Tab, Echap, Retour, Suppr, Haut, Bas, Gauche, Droite, Debut, Fin, PageHaut,
  # PageBas, CtrlA, CtrlC, CtrlV, CtrlX, CtrlZ), crans de molette (+ = haut), et frappe sans reclic.
  [string]$Touche = '',
  [ValidateRange(-20, 20)][int]$Molette = 0,
  # Touches virtuelles en hexadecimal, « 28x15,0D » = 15 x Fleche bas puis Entree (menus Qt de Studio).
  [string]$Touches = '',
  [switch]$SansClic,
  # Dossier du journal des gestes et des lectures gardees. Defaut : %LOCALAPPDATA%/autowin-hdesk (meme
  # registre que le lanceur). Les TESTS passent un dossier temporaire.
  [string]$Registre = ''
)
$ErrorActionPreference = 'Stop'
# conv-1374 (2026-10-31) : le refus cite les titres de fenetres, et Node lit stderr en UTF-8 alors que
# la console sort en page de code 850 : le e accent grave de « Table des caracteres » partait en octet
# 8A, illisible en UTF-8 (mesure sur charmap : C3 A8 une fois la console en UTF-8).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$dossierRegistre = if ([string]::IsNullOrWhiteSpace($Registre)) { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'autowin-hdesk' } else { $Registre }
# JOURNAL DES GESTES (conv-344, scout n°5) : chaque geste — de la petite TV, de la vue « Bureaux
# caches » ou d'un agent — ajoute une ligne a <registre>/<id>.gestes.jsonl, reussi ou refuse. JAMAIS le
# texte tape (un mot de passe passe par ici) : seulement son nombre de caracteres. Borne aux 200
# dernieres lignes ; efface avec le bureau (purgerBureauxFermes). Un echec du journal ne casse pas le geste.
function NoterGeste([bool]$ok, [string]$erreur) {
  try {
    New-Item -ItemType Directory -Path $dossierRegistre -Force | Out-Null
    $journal = Join-Path $dossierRegistre "$InstanceId.gestes.jsonl"
    $champs = [ordered]@{ quand = (Get-Date).ToString('o'); ok = $ok }
    # Frappe vers le focus : pas de point a noter (-1 se lirait comme une position).
    if ($X -ge 0 -and $Y -ge 0) { $champs.x = $X; $champs.y = $Y }
    $champs.clic = (-not $SansClic)
    if ($Element) { $champs.element = $Element }
    if ($Remplir) { $champs.remplir = $true }
    if ($Texte) { $champs.caracteres = $Texte.Length }
    if ($Entree) { $champs.entree = $true }
    if ($Touche) { $champs.touche = $Touche }
    if ($Molette) { $champs.molette = $Molette }
    if ($Touches) { $champs.touches = @($Touches -split ',' | Where-Object { $_ }).Count }
    if ($erreur) { $champs.erreur = $erreur }
    $ligne = [pscustomobject]$champs | ConvertTo-Json -Compress
    $anciennes = @()
    if (Test-Path -LiteralPath $journal) { $anciennes = @(Get-Content -LiteralPath $journal -Encoding UTF8 | Where-Object { $_.Trim() }) }
    $gardees = @(@($anciennes) + @($ligne) | Select-Object -Last 200)
    [IO.File]::WriteAllText($journal, (($gardees -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
  } catch { }
}
# Ou en est le geste quand une erreur coupe le script : rien n'est parti tant qu'un envoi ne l'a pas dit.
$script:arrive = 'non'
$script:refaisable = $true
function Refaisable([string]$appui) { return ($appui -eq 'accessibilite:SetValue' -or $appui -eq 'accessibilite:Select') }
trap {
  NoterGeste $false $_.Exception.Message
  $message = $_.Exception.Message
  if ($script:arrive -eq 'incertain') { $message += "`nLe geste a peut-etre porte : re-observe avant de le refaire, par quelque moyen que ce soit." }
  elseif ($script:arrive -eq 'oui') { $message += "`nLe geste est arrive avant cette erreur : re-observe, ne le refais pas a l'aveugle." }
  [Console]::Out.WriteLine(([pscustomobject][ordered]@{ instanceId = $InstanceId; arrive = $script:arrive; refaisable = $script:refaisable } | ConvertTo-Json -Compress))
  [Console]::Error.WriteLine($message)
  exit 1
}
# Ce que l'agent peut faire apres chaque refus d'un appui par element (code de hdesk-arbre.cs).
$reessais = @{
  PERIME      = "Reessai : relis l'arbre (bureau_cache_observer), puis vise le nouveau repere."
  INVALIDE    = "Reessai : pas tel quel ; vise un repere, un id ou un nom de l'arbre."
  INTROUVABLE = "Reessai : pas tel quel ; vise un repere, un id ou un nom de l'arbre."
  AMBIGU      = "Reessai : pas tel quel ; vise le repere (@...) d'un des candidats."
  INACTIF     = "Reessai : pas tel quel ; fais d'abord l'etape qui active l'element, puis relis l'arbre."
  HORS_ECRAN  = "Reessai : fais defiler (molette) jusqu'a l'element, relis l'arbre, puis vise-le."
  REFUSE      = "Reessai : par un autre moyen, x/y sur l'image."
  SANS_ARBRE  = "Reessai : par un autre moyen, x/y sur l'image."
}
# fix-ok: fonctionnalité neuve (conv-1457) mesurée avant : case WPF non agrandie restée « Off » après 2 clics postés au centre, « On » par TogglePattern ; 3 édits = paramètres, journal, appui.
$Element = $Element.Trim()
if ($TexteEntree) {
  if ($Texte) { throw 'Passe -Texte OU -TexteEntree, pas les deux.' }
  try { [Console]::InputEncoding = New-Object Text.UTF8Encoding $false } catch { }
  $Texte = [Console]::In.ReadToEnd()
  # Un tube PowerShell ajoute une fin de ligne au texte envoye : on en retire UNE. Entree = -Entree.
  if ($Texte.EndsWith("`r`n")) { $Texte = $Texte.Substring(0, $Texte.Length - 2) }
  elseif ($Texte.EndsWith("`n")) { $Texte = $Texte.Substring(0, $Texte.Length - 1) }
}
$avecPoint = $PSBoundParameters.ContainsKey('X') -or $PSBoundParameters.ContainsKey('Y')
if ($Element) {
  if ($avecPoint) { throw 'Passe -Element OU -X/-Y, pas les deux.' }
  if ($Element.Length -gt 200) { throw 'Element trop long (200 caracteres au plus).' }
  if ($Entree -or $Touche -or $Molette -or $Touches -or $SansClic) {
    throw 'Avec -Element, un seul appui : ni frappe, ni touche, ni molette, ni -SansClic. Appuie sur l''element, puis tape avec -SansClic (le curseur reste pose) ou vise -X/-Y.'
  }
  if ($Texte -and -not $Remplir) {
    throw 'Avec -Element, le texte va avec -Remplir (remplir le champ). Pour taper au clavier : appuie sur l''element, puis tape avec -SansClic, ou vise -X/-Y.'
  }
} elseif ($Remplir) {
  throw '-Remplir va avec -Element (le champ a remplir).'
} elseif (-not ($PSBoundParameters.ContainsKey('X') -and $PSBoundParameters.ContainsKey('Y'))) {
  if ($avecPoint) { throw '-X et -Y vont ensemble.' }
  if (-not $SansClic) { throw 'Passe -Element, ou -X et -Y ; ou -SansClic seul pour une frappe vers le focus clavier.' }
  if ($Molette) { throw 'La molette vise un point : passe -X et -Y.' }
  if (-not ($Texte -or $Entree -or $Touche -or $Touches)) { throw 'Rien a envoyer : -SansClic sans point attend -Texte, -Touche, -Touches ou -Entree.' }
  # Sans point : hdesk-act.cs envoie au controle qui a le focus clavier (FenetreAuFocus).
}
. (Join-Path $PSScriptRoot 'hdesk-types.ps1')
$bureau = "AutowinTest_$InstanceId"
$appui = $null
$vise = $null
$res = $null
function EtatApres {
  if ($AttenteMs -le 0 -or -not $res) { return $null }
  try { return ([AutowinHdeskArbre]::EtatApres($bureau, $res, $AttenteMs) | ConvertFrom-Json) }
  catch { return $null }
}
if ($Element) {
  # Meme code que hdesk-arbre.ps1 pour trouver l'element : une seule facon de le resoudre.
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
  $refs = @(
    [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.ControlType].Assembly.Location,
    [System.Windows.Rect].Assembly.Location
  )
  Import-HdeskType -Source (Join-Path $PSScriptRoot 'hdesk-arbre.cs') -Type 'AutowinHdeskArbre' -References $refs
  $lectures = Join-Path $dossierRegistre "$InstanceId.lectures.txt"
  $res = [AutowinHdeskArbre]::Appuyer($bureau, $Element, $OrigineX, $OrigineY, $lectures, [bool]$Remplir, $Texte)
  if ($res.Erreur) {
    $code = if ($res.Code) { $res.Code } else { 'REFUSE' }
    # Appel d'accessibilite parti puis leve : le reessai « par un autre moyen » pourrait doubler le geste ;
    # la trappe dit a la place de re-observer d'abord.
    if ($res.Tente) { $script:arrive = 'incertain'; $script:refaisable = $false }
    $suite = if ($reessais.ContainsKey($code) -and -not $res.Tente) { "`n" + $reessais[$code] } else { '' }
    throw "[$code] $($res.Erreur)$suite"
  }
  $appui = $res.Appui
  if ($appui -ne 'clic') {
    $script:arrive = 'oui'
    $script:refaisable = Refaisable $appui
  }
  $vise = $res.Json | ConvertFrom-Json
  if ($appui -ne 'clic') {
    $apres = EtatApres
    NoterGeste $true ''
    $sortie = [ordered]@{ instanceId = $InstanceId; element = $vise; appui = $appui; arrive = $script:arrive; refaisable = $script:refaisable }
    if ($apres) { $sortie.apres = $apres }
    [pscustomobject]$sortie | ConvertTo-Json -Compress -Depth 6
    exit 0
  }
  # Element sans motif utilisable (Win32...) : clic au centre, par le chemin habituel ci-dessous.
  $X = $res.X
  $Y = $res.Y
}
Import-HdeskType -Source (Join-Path $PSScriptRoot 'hdesk-act.cs') -Type 'AutowinHdeskAct'
$r = [AutowinHdeskAct]::Run($bureau, $X, $Y, $Texte, [bool]$Entree, $Touche, $Molette, $Touches, [bool]$SansClic)
# hdesk-act.cs refuse tout avant le premier message poste ; un envoi deja parti reste dit, au cas ou.
if ($r.Envoyes -gt 0) { $script:arrive = $(if ($r.Error) { 'incertain' } else { 'oui' }); $script:refaisable = $false }
if ($r.Error) { throw $r.Error }
$apres = if ($appui) { EtatApres } else { $null }
NoterGeste $true ''
$sortie = [ordered]@{ instanceId = $InstanceId }
if ($X -ge 0 -and $Y -ge 0) { $sortie.x = $X; $sortie.y = $Y } else { $sortie.vers = 'focus' }
$sortie.cible = $r.Cible
$sortie.messages = $r.Envoyes
$sortie.arrive = $script:arrive
$sortie.refaisable = $script:refaisable
if ($appui) { $sortie.element = $vise; $sortie.appui = $appui }
if ($apres) { $sortie.apres = $apres }
# Clic + fleches d'un seul geste : la liste ouverte se referme avant la capture (hdesk-act-avertissements.ps1).
. (Join-Path $PSScriptRoot 'hdesk-act-avertissements.ps1')
if (-not $SansClic -and (Test-ClicPuisNavigation -Touches $Touches -Touche $Touche)) {
  $sortie.avertissement = $avertissementListeFermee
}
[pscustomobject]$sortie | ConvertTo-Json -Compress -Depth 6
exit 0
