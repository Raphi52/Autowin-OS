<#
  LIRE L'ARBRE D'ACCESSIBILITE D'UN BUREAU WINDOWS CACHE (HDESK), sans toucher a l'ecran de l'utilisateur.
  Complete hdesk-lancer.ps1 (lancer), hdesk-observe.ps1 (voir) et hdesk-act.ps1 (agir) : meme bureau
  AutowinTest_<id>.

  Pourquoi (conv-1457, 2026-11-03) : un agent ne savait viser que des pixels de capture. Ce script rend les
  elements des fenetres visibles (type, nom, identifiant, libelle, technologie, rectangle, actif, coche,
  valeur), ce qui permet a hdesk-act.ps1 -Element d'appuyer par NOM. Code dans hdesk-arbre.cs.
  Depuis le 2026-11-08, chaque lecture porte un identifiant (`lecture`) et chaque element un repere
  (`ref`, « @<lecture>:e<n> ») : hdesk-act.ps1 -Element @<lecture>:e<n> refuse le geste si l'element a
  change depuis. La lecture est gardee dans <registre>/<id>.lectures.txt (les 5 dernieres).

  Depuis le 2026-11-26, -Racine lit une seule ZONE (repere @<lecture>:e<n>, identifiant, nom ou libelle) :
  seuls ses descendants sont rendus, et le JSON porte `racine` (l'element lui-meme). Un ecran charge
  depassait la limite de texte rendue a l'agent ; il y descend maintenant zone par zone.

  Depuis le 2026-11-26 aussi, la lecture peut ATTENDRE sa cible (reprise de la commande wait de
  vercel-labs/agent-desktop) : -AttendreElement (resolu comme -Element de hdesk-act.ps1), -AttendreTexte
  (nom, libelle ou valeur d'un element) ou -AttendreFenetre (titre), au plus -DelaiMs. Un ecran qui charge
  ne demande plus de relire en boucle : la lecture part des que la cible est la.

  Usage : powershell -NoProfile -File scripts/hdesk-arbre.ps1 -InstanceId <id> [-Plafond 500] [-Registre <dossier>]
          [-Racine:<cible>] [-OrigineX <x> -OrigineY <y>]
          [-AttendreElement:<cible> | -AttendreTexte:<texte> | -AttendreFenetre:<titre>] [-DelaiMs 10000]
  -Racine:<cible> colle la valeur au parametre : sinon une cible qui commence par un tiret (« - », « — »)
  est lue comme un nom de parametre (mesure du 2026-11-26 : « — » seul sortait en code 2, sans message).
  Meme regle pour les trois -Attendre*.
  Sortie : une ligne JSON {bureau, lecture, attente?, racine?, fenetres[], total, omis, elements[]}, positions en
  pixels de l'ECRAN du bureau (ceux de hdesk-act -X/-Y). Au plus -Plafond elements ; `omis` compte le reste.
  Arbre vide (page web, rendu GPU) : `elements` vide, ce n'est pas une erreur. Code 1 = bureau introuvable,
  lecture impossible, racine ou attente refusee (« [CODE] message », codes de hdesk-act -Element), message
  sur stderr. Code 3 = attente ecoulee sans voir la cible : la ligne JSON est rendue quand meme (l'ecran a
  la fin du delai, `attente.trouve: false`), et « [DELAI] ... » part sur stderr.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [ValidateRange(1, 5000)][int]$Plafond = 500,
  # Dossier des lectures gardees. Defaut : %LOCALAPPDATA%/autowin-hdesk (celui de hdesk-act.ps1).
  # Les TESTS passent un dossier temporaire.
  [string]$Registre = '',
  # Zone a lire seule. Bornee comme -Element de hdesk-act.ps1 (ELEMENT_MAX, src/main/bureau/hdesk-tv.ts).
  [ValidateLength(0, 200)][string]$Racine = '',
  # Origine de la capture recadree (comme hdesk-act.ps1) : positions des refus de -Racine en pixels de l'image.
  [ValidateRange(0, 32767)][int]$OrigineX = 0,
  [ValidateRange(0, 32767)][int]$OrigineY = 0,
  # Attendre avant de lire : UNE cible parmi les trois. Bornees comme -Racine.
  [ValidateLength(0, 200)][string]$AttendreElement = '',
  [ValidateLength(0, 200)][string]$AttendreTexte = '',
  [ValidateLength(0, 200)][string]$AttendreFenetre = '',
  # Delai maximal de l'attente, borne comme ATTENTE_MAX_MS de hdesk-arbre.cs.
  [ValidateRange(0, 30000)][int]$DelaiMs = 10000
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$refs = @(
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.ControlType].Assembly.Location,
  [System.Windows.Rect].Assembly.Location
)
. (Join-Path $PSScriptRoot 'hdesk-types.ps1')
Import-HdeskType -Source (Join-Path $PSScriptRoot 'hdesk-arbre.cs') -Type 'AutowinHdeskArbre' -References $refs
$dossier = if ([string]::IsNullOrWhiteSpace($Registre)) { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'autowin-hdesk' } else { $Registre }
$lectures = Join-Path $dossier "$InstanceId.lectures.txt"
$attentes = @(@(
    @{ quoi = 'element'; cible = $AttendreElement },
    @{ quoi = 'texte'; cible = $AttendreTexte },
    @{ quoi = 'fenetre'; cible = $AttendreFenetre }
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_.cible) })
if ($attentes.Count -gt 1) { throw '[INVALIDE] Une seule attente a la fois : -AttendreElement, -AttendreTexte OU -AttendreFenetre.' }
if ($attentes.Count -eq 0 -and [string]::IsNullOrWhiteSpace($Racine)) {
  [Console]::Out.WriteLine([AutowinHdeskArbre]::Lire("AutowinTest_$InstanceId", $Plafond, $lectures))
  exit 0
}
$zone = if ($attentes.Count -eq 1) {
  [AutowinHdeskArbre]::Attendre("AutowinTest_$InstanceId", $Plafond, $lectures, $Racine, $attentes[0].quoi, $attentes[0].cible, $DelaiMs, $OrigineX, $OrigineY)
} else {
  [AutowinHdeskArbre]::LireZone("AutowinTest_$InstanceId", $Plafond, $lectures, $Racine, $OrigineX, $OrigineY)
}
if ($zone.Erreur) {
  $code = if ($zone.Code) { $zone.Code } else { 'REFUSE' }
  # Les reessais visent la racine ; un refus de l'attente elle-meme (INVALIDE) dit deja quoi passer.
  $suite = if ($attentes.Count -eq 1 -and $code -eq 'INVALIDE') { $null } else { @{
    PERIME      = "Reessai : relis l'arbre (bureau_cache_observer sans racine), puis vise le nouveau repere."
    AMBIGU      = "Reessai : pas tel quel ; passe le repere (@...) d'un des candidats."
    INTROUVABLE = "Reessai : pas tel quel ; passe un repere, un id ou un nom de l'arbre."
    INVALIDE    = "Reessai : pas tel quel ; passe un repere, un id ou un nom de l'arbre."
  }[$code] }
  throw ("[$code] $($zone.Erreur)" + $(if ($suite) { "`n$suite" } else { '' }))
}
[Console]::Out.WriteLine($zone.Json)
if ($zone.Expiree) {
  [Console]::Error.WriteLine("[DELAI] $($attentes[0].quoi) '$($attentes[0].cible)' toujours absent apres $DelaiMs ms : la lecture rendue montre l'ecran a cet instant.")
  exit 3
}
exit 0
