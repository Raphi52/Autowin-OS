<#
  GLISSER DANS UN BUREAU WINDOWS CACHE (HDESK), sans toucher a l'ecran ni a la souris de l'utilisateur.
  Complete hdesk-act.ps1 (clic, frappe) : appui en (X1,Y1), deplacement en -Pas etapes jusqu'a (X2,Y2),
  relache. Coordonnees = pixels de la capture hdesk-observe.ps1 (bureau entier).
  Pourquoi (conv-1997, 19/11/2026) : prouver le glisser-deposer de tuiles d'une application WebView2
  sur le bureau cache ; hdesk-act ne sait que cliquer.
  Usage : powershell -NoProfile -File scripts/hdesk-glisser.ps1 -InstanceId <id> -X1 500 -Y1 430 -X2 900 -Y2 430 [-Pas 12] [-PauseMs 30]
  Limite : messages fenetre (PostMessage), comme hdesk-act ; verifier l'effet par une capture apres coup.
  Mesure (conv-1997) : une tuile glissee de 3 colonnes sur le bureau cache, pose relue apres relance de l'appli.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [Parameter(Mandatory = $true)][ValidateRange(0, 32767)][int]$X1,
  [Parameter(Mandatory = $true)][ValidateRange(0, 32767)][int]$Y1,
  [Parameter(Mandatory = $true)][ValidateRange(0, 32767)][int]$X2,
  [Parameter(Mandatory = $true)][ValidateRange(0, 32767)][int]$Y2,
  [ValidateRange(1, 200)][int]$Pas = 12,
  [ValidateRange(0, 1000)][int]$PauseMs = 30
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
. (Join-Path $PSScriptRoot 'hdesk-types.ps1')
Import-HdeskType -Source (Join-Path $PSScriptRoot 'hdesk-glisser.cs') -Type 'AutowinHdeskGlisser'
$r = [AutowinHdeskGlisser]::Run("AutowinTest_$InstanceId", $X1, $Y1, $X2, $Y2, $Pas, $PauseMs)
if ($r.Error) { [Console]::Error.WriteLine($r.Error); exit 1 }
[pscustomobject]([ordered]@{ instanceId = $InstanceId; de = @($X1, $Y1); vers = @($X2, $Y2); pas = $Pas; cible = $r.Cible; messages = $r.Envoyes }) | ConvertTo-Json -Compress
exit 0
