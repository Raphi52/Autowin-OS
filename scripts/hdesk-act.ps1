<#
  CLIQUER ET TAPER DANS UN BUREAU WINDOWS CACHE (HDESK), sans toucher a l'ecran de l'utilisateur.
  Complete hdesk-lancer.ps1 (lancer) et hdesk-observe.ps1 (voir) : meme bureau AutowinTest_<id>.

  Pourquoi (kaizen conv-854, tour 78a0d7d3-6a84-4d86-a3a7-fd1b5cc1393f, saisie ts 1790278416518) :
  pour saisir un code de connexion, l'agent a clique dans la barre des taches de l'ecran REEL, faute
  de tout moyen d'agir dans le bureau cache. L'utilisateur a arrete le tour et demande que ce genre
  de tache se fasse dans le bureau cache.

  Usage : powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -X 400 -Y 300 [-Texte "CODE"] [-Entree]
  Clique en (X,Y) (coordonnees de la capture hdesk-observe), puis tape -Texte dans la fenetre visee.
  Limite : messages fenetre (PostMessage), pas SendInput — une app qui lit le clavier brut peut les ignorer ;
  verifier par une capture hdesk-observe apres coup.
  Mesure 2026-09-24 (Brave 154, --disable-gpu) : clic + frappe RECUS par Brave (barre d'adresse = "about:blankCXC8M5FC5",
  Audit/hact/brave2-apres.png). MAIS le contenu web s'affiche uni (blanc/noir) dans la capture du bureau cache :
  on ne peut pas VOIR un formulaire de page ; seule l'interface native du navigateur (barre d'adresse) est lisible.
  Mesure 2026-09-24 (champ de FORMULAIRE web) : page locale Audit/hact/device.html (input autofocus, oninput -> document.title)
  ouverte en --app dans le bureau cache ; clic (400,300) + frappe CXC8M5FC5 -> titre de fenetre lu via EnumDesktopWindows
  = "SAISI:CXC8M5FC5" (Audit/hact/titres.ps1). La frappe atteint donc un champ web ; pour VERIFIER sans capture, lire le titre.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [string]$Texte = '',
  [switch]$Entree
)
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'hdesk-act.cs'))
$r = [AutowinHdeskAct]::Run("AutowinTest_$InstanceId", $X, $Y, $Texte, [bool]$Entree)
if ($r.Error) { throw $r.Error }
[pscustomobject]@{ instanceId = $InstanceId; x = $X; y = $Y; cible = $r.Cible; messages = $r.Envoyes } | ConvertTo-Json -Compress
exit 0
