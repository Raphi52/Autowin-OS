<#
  LIRE L'ARBRE D'ACCESSIBILITE D'UN BUREAU WINDOWS CACHE (HDESK), sans toucher a l'ecran de l'utilisateur.
  Complete hdesk-lancer.ps1 (lancer), hdesk-observe.ps1 (voir) et hdesk-act.ps1 (agir) : meme bureau
  AutowinTest_<id>.

  Pourquoi (conv-1457, 2026-11-03) : un agent ne savait viser que des pixels de capture. Ce script rend les
  elements des fenetres visibles (type, nom, identifiant, libelle, technologie, rectangle, actif, coche,
  valeur), ce qui permet a hdesk-act.ps1 -Element d'appuyer par NOM. Code dans hdesk-arbre.cs.

  Usage : powershell -NoProfile -File scripts/hdesk-arbre.ps1 -InstanceId <id> [-Plafond 500]
  Sortie : une ligne JSON {bureau, fenetres[], total, omis, elements[]}, positions en pixels de l'ECRAN du
  bureau (ceux de hdesk-act -X/-Y). Au plus -Plafond elements ; `omis` compte le reste.
  Arbre vide (page web, rendu GPU) : `elements` vide, ce n'est pas une erreur. Code 1 = bureau introuvable
  ou lecture impossible, message sur stderr.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [ValidateRange(1, 5000)][int]$Plafond = 500
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
Add-Type -ReferencedAssemblies $refs -TypeDefinition (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'hdesk-arbre.cs'))
[Console]::Out.WriteLine([AutowinHdeskArbre]::Lire("AutowinTest_$InstanceId", $Plafond))
exit 0
