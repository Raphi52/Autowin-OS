<#
  OBSERVER un BUREAU WINDOWS ISOLE (HDESK) : rend une capture de TOUT le bureau, pas seulement
  de la fenetre de l'app. C'est la difference qui compte — une boite de dialogue systeme, un
  crash Windows ou une fenetre parasite naissent DANS ce bureau et n'apparaissent nulle part
  ailleurs. La capture par le port de debogage de l'app, elle, ne voit que la page.

  Le thread s'attache au bureau (SetThreadDesktop) AVANT de demander son contexte d'affichage :
  sans cette attache, GetDC rendrait le bureau interactif de l'utilisateur, donc une capture de
  SON ecran — l'inverse exact de ce qu'on cherche.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }

Add-Type -AssemblyName System.Drawing
# TOUTE LA CAPTURE VIT DANS UN THREAD NEUF. Mesure du 2026-09-12 : appele depuis le thread
# principal de PowerShell, SetThreadDesktop echoue avec Win32 170 (ERROR_BUSY) — un thread qui
# possede deja des fenetres ne peut PAS changer de bureau. Meme parade que RigDesktop.cs : un
# thread cree pour l'occasion, qui s'attache AVANT de toucher quoi que ce soit de graphique.
# Code C# PARTAGE avec scripts/hdesk-tv.ps1 (processus de capture ouvert) : un seul exemplaire.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'hdesk-shot.cs'))

$racineDepot = Split-Path -Parent $PSScriptRoot
$nomBureau = "AutowinTest_$InstanceId"
if ([string]::IsNullOrWhiteSpace($Output)) {
  $dossier = Join-Path (Join-Path $racineDepot 'Audit') 'hdesk-observe'
  New-Item -ItemType Directory -Path $dossier -Force | Out-Null
  $Output = Join-Path $dossier "$InstanceId-$(Get-Date -Format 'yyyyMMdd-HHmmss').png"
}

$resultat = [AutowinHdeskShot]::Capture($nomBureau, $Output)
if ($resultat.Error) { throw $resultat.Error }
[pscustomobject]@{
  instanceId = $InstanceId; desktop = $nomBureau; width = $resultat.Width; height = $resultat.Height
  fenetres = $resultat.Windows; fenetresDessinees = $resultat.Painted
  couleursDistinctes = $resultat.Distinct; uni = ($resultat.Distinct -le 1); octets = $resultat.Bytes; output = $Output
  zonesUnies = @($resultat.ZonesUnies)
  avertissement = $(if ($resultat.ZonesUnies.Count -gt 0) { 'vue(s) graphique(s) restee(s) unie(s) : rendu GPU (3D, video) non capturable sur un bureau cache, ne pas conclure sur leur contenu' } else { $null })
} | ConvertTo-Json -Compress
if ($resultat.Distinct -le 1) { exit 2 }
if ($resultat.ZonesUnies.Count -gt 0) { exit 3 }
exit 0
