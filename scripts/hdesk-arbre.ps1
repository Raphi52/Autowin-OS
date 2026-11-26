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

  Usage : powershell -NoProfile -File scripts/hdesk-arbre.ps1 -InstanceId <id> [-Plafond 500] [-Registre <dossier>]
          [-Racine:<cible>] [-OrigineX <x> -OrigineY <y>]
  -Racine:<cible> colle la valeur au parametre : sinon une cible qui commence par un tiret (« - », « — »)
  est lue comme un nom de parametre (mesure du 2026-11-26 : « — » seul sortait en code 2, sans message).
  Sortie : une ligne JSON {bureau, lecture, racine?, fenetres[], total, omis, elements[]}, positions en
  pixels de l'ECRAN du bureau (ceux de hdesk-act -X/-Y). Au plus -Plafond elements ; `omis` compte le reste.
  Arbre vide (page web, rendu GPU) : `elements` vide, ce n'est pas une erreur. Code 1 = bureau introuvable,
  lecture impossible ou racine refusee (« [CODE] message », codes de hdesk-act -Element), message sur stderr.
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
  [ValidateRange(0, 32767)][int]$OrigineY = 0
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
if ([string]::IsNullOrWhiteSpace($Racine)) {
  [Console]::Out.WriteLine([AutowinHdeskArbre]::Lire("AutowinTest_$InstanceId", $Plafond, $lectures))
  exit 0
}
$zone = [AutowinHdeskArbre]::LireZone("AutowinTest_$InstanceId", $Plafond, $lectures, $Racine, $OrigineX, $OrigineY)
if ($zone.Erreur) {
  $code = if ($zone.Code) { $zone.Code } else { 'REFUSE' }
  $suite = @{
    PERIME      = "Reessai : relis l'arbre (bureau_cache_observer sans racine), puis vise le nouveau repere."
    AMBIGU      = "Reessai : pas tel quel ; passe le repere (@...) d'un des candidats."
    INTROUVABLE = "Reessai : pas tel quel ; passe un repere, un id ou un nom de l'arbre."
    INVALIDE    = "Reessai : pas tel quel ; passe un repere, un id ou un nom de l'arbre."
  }[$code]
  throw ("[$code] $($zone.Erreur)" + $(if ($suite) { "`n$suite" } else { '' }))
}
[Console]::Out.WriteLine($zone.Json)
exit 0
