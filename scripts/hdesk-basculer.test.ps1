<#
  BANC LIVE de scripts/hdesk-basculer.ps1 en mode -Essai : la fenetre « Revenir a mon bureau » est-elle
  VRAIMENT a l'ecran quand le script est lance comme l'app le lance ? Jamais l'ecran de l'utilisateur :
  -Essai construit la sortie sur un bureau cache propre au banc, la mesure, la ferme, et ne bascule pas.

  Pourquoi (conv-1528, 2026-11-04) : « Afficher sur mon ecran » basculait, mais souris et clavier ne
  faisaient rien. Lance par WMI (scripts/lancer-detache.ps1, ShowWindow=0), le premier ShowWindow du
  processus est force en SW_HIDE : la fenetre « Revenir » existait, invisible (IsWindowVisible=False),
  alors que le meme code lance a la main etait visible.
  Entree qui doit faire ECHOUER ce banc si la sortie redevenait invisible : retirer de hdesk-basculer.ps1
  le ShowWindow de OnShown -> visible=false -> code 1.
  Usage : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hdesk-basculer.test.ps1 [-Dossier <dossier des scripts>]
  Code 0 = vert ; 1 = rouge ; 2 = banc impossible a monter.
#>
param([string]$Dossier = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$travail = Join-Path $env:TEMP "hdtest-bascule-$PID"
$registre = Join-Path $travail 'registre'
New-Item -ItemType Directory -Force $registre | Out-Null
$id = "hdtest-bascule-$PID"
$statut = Join-Path $travail 'statut.json'

$echecs = New-Object System.Collections.Generic.List[string]
function Verifier([bool]$ok, [string]$quoi) {
  if ($ok) { Write-Output "ok    : $quoi" } else { Write-Output "ROUGE : $quoi"; $echecs.Add($quoi) }
}

$code = 1
$lancements = @()
try {
  # Un bureau cache du banc, tenu ouvert par la Table des caracteres.
  $charmap = Join-Path $env:WINDIR 'System32\charmap.exe'
  if (-not (Test-Path $charmap)) { Write-Output 'BANC IMPOSSIBLE : charmap.exe absent'; exit 2 }
  $l = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-lancer.ps1') `
    -Id $id -Executable $charmap -Travail 'banc hdesk-basculer (essai)' -Conversation 'banc-hdesk' `
    -AttenteSecondes 30 -SurvieSecondes 1 -Registre $registre | ConvertFrom-Json
  if (-not $l.pid) { Write-Output "BANC IMPOSSIBLE : bureau du banc non lance ($($l.erreur))"; exit 2 }
  $lancements += [int]$l.pid

  # LE MEME LANCEMENT QUE L'APP (src/main/hdesk-tv.ts, argumentsLancementBascule) : par WMI, fenetre cachee.
  $script = Join-Path $Dossier 'hdesk-basculer.ps1'
  $commande = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`" -InstanceId $id -MaxSecondes 5 -Statut `"$statut`" -Essai"
  $d = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'lancer-detache.ps1') -Commande $commande -Dossier $travail | ConvertFrom-Json
  if (-not $d.pid) { Write-Output "BANC IMPOSSIBLE : lancement WMI refuse ($($d.erreur))"; exit 2 }
  Verifier ($d.horsJob -eq $true) "script lance par WMI, hors du Job (pid $($d.pid))"

  $etat = $null
  $limite = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 300
    if (Test-Path $statut) { try { $etat = Get-Content -Raw -LiteralPath $statut | ConvertFrom-Json } catch { $etat = $null } }
  } while ((-not $etat) -and (Get-Date) -lt $limite)
  if (-not $etat) { Write-Output 'BANC IMPOSSIBLE : aucun verdict du script en 45 s'; exit 2 }
  Verifier ($etat.etat -eq 'essai') "le script a tourne en essai, sans basculer (etat lu : '$($etat.etat)' $($etat.message))"
  Verifier ($etat.visible -eq $true) "la fenetre « Revenir » est visible a l'ecran (visible lu : '$($etat.visible)')"
} finally {
  foreach ($p in $lancements) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $travail -ErrorAction SilentlyContinue
}
if ($echecs.Count -eq 0) { Write-Output 'VERT : la sortie du bureau cache est visible, lancee comme par l''app'; $code = 0 }
else { Write-Output "ROUGE : $($echecs.Count) verification(s) en echec" }
exit $code
