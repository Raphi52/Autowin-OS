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
  [switch]$Entree,
  # conv-35 : touche nommee (Tab, Echap, Retour, Suppr, Haut, Bas, Gauche, Droite, Debut, Fin, PageHaut,
  # PageBas, CtrlA, CtrlC, CtrlV, CtrlX, CtrlZ), crans de molette (+ = haut), et frappe sans reclic.
  [string]$Touche = '',
  [ValidateRange(-20, 20)][int]$Molette = 0,
  # Touches virtuelles en hexadecimal, « 28x15,0D » = 15 x Fleche bas puis Entree (menus Qt de Studio).
  [string]$Touches = '',
  [switch]$SansClic,
  # Dossier du journal des gestes. Defaut : %LOCALAPPDATA%/autowin-hdesk (meme registre que le lanceur).
  # Les TESTS passent un dossier temporaire.
  [string]$Registre = ''
)
$ErrorActionPreference = 'Stop'
# conv-1374 (2026-10-31) : le refus cite les titres de fenetres, et Node lit stderr en UTF-8 alors que
# la console sort en page de code 850 : le e accent grave de « Table des caracteres » partait en octet
# 8A, illisible en UTF-8 (mesure sur charmap : C3 A8 une fois la console en UTF-8).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
# JOURNAL DES GESTES (conv-344, scout n°5) : chaque geste — de la petite TV, de la vue « Bureaux
# caches » ou d'un agent — ajoute une ligne a <registre>/<id>.gestes.jsonl, reussi ou refuse. JAMAIS le
# texte tape (un mot de passe passe par ici) : seulement son nombre de caracteres. Borne aux 200
# dernieres lignes ; efface avec le bureau (purgerBureauxFermes). Un echec du journal ne casse pas le geste.
function NoterGeste([bool]$ok, [string]$erreur) {
  try {
    $dossier = if ([string]::IsNullOrWhiteSpace($Registre)) { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'autowin-hdesk' } else { $Registre }
    New-Item -ItemType Directory -Path $dossier -Force | Out-Null
    $journal = Join-Path $dossier "$InstanceId.gestes.jsonl"
    $champs = [ordered]@{ quand = (Get-Date).ToString('o'); ok = $ok; x = $X; y = $Y; clic = (-not $SansClic) }
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
trap { NoterGeste $false $_.Exception.Message; [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'hdesk-act.cs'))
$r = [AutowinHdeskAct]::Run("AutowinTest_$InstanceId", $X, $Y, $Texte, [bool]$Entree, $Touche, $Molette, $Touches, [bool]$SansClic)
if ($r.Error) { throw $r.Error }
NoterGeste $true ''
[pscustomobject]@{ instanceId = $InstanceId; x = $X; y = $Y; cible = $r.Cible; messages = $r.Envoyes } | ConvertTo-Json -Compress
exit 0
