<#
.SYNOPSIS
  Exporte en PNG tous les graphiques d'un classeur Excel et toutes les diapositives d'une présentation
  PowerPoint, sans rien afficher à l'écran : la preuve visuelle d'un livrable Office.

.DESCRIPTION
  Excel et PowerPoint tournent en instances invisibles, le fichier est ouvert en lecture seule et refermé sans
  enregistrer : un classeur déjà ouvert par l'utilisateur n'est ni modifié ni fermé, et un PowerPoint qu'il
  a déjà ouvert reste ouvert (seule la présentation exportée y est refermée). Un graphique n'est exporté
  qu'une fois sa feuille et lui-même activés : sans cela Excel rend une image vide (constaté sur un graphique
  placé sous l'écran visible).

.EXAMPLE
  powershell -NoProfile -File scripts/office-apercu.ps1 -Xlsx C:\x\rapport.xlsx -Pptx C:\x\rapport.pptx -Sortie C:\x\apercu
  Sortie : une ligne JSON {"images":[...]} ; excel-<feuille>-<n>.png et diapositive-<n>.png dans -Sortie.
#>
param(
  [string]$Xlsx,
  [string]$Pptx,
  [Parameter(Mandatory = $true)][string]$Sortie
)
$ErrorActionPreference = 'Stop'
if (-not $Xlsx -and -not $Pptx) { throw 'Donne au moins -Xlsx ou -Pptx.' }
New-Item -ItemType Directory -Force -Path $Sortie | Out-Null
$Sortie = (Resolve-Path $Sortie).Path
$images = New-Object System.Collections.Generic.List[string]

function Nom-De-Fichier([string]$texte) {
  ($texte -replace '[^\p{L}\p{Nd}]+', '-').Trim('-').ToLowerInvariant()
}

if ($Xlsx) {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false
  try {
    $wb = $xl.Workbooks.Open((Resolve-Path $Xlsx).Path, 0, $true)
    foreach ($ws in $wb.Worksheets) {
      $n = 0
      foreach ($co in $ws.ChartObjects()) {
        $n++
        $ws.Activate()
        $xl.ActiveWindow.ScrollRow = $co.TopLeftCell.Row
        $co.Activate()
        Start-Sleep -Milliseconds 300
        $png = Join-Path $Sortie ("excel-{0}-{1}.png" -f (Nom-De-Fichier $ws.Name), $n)
        [void]$co.Chart.Export($png)
        $images.Add($png)
      }
    }
    $wb.Close($false)
  } finally {
    $xl.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  }
}

if ($Pptx) {
  # PowerPoint n'a qu'une instance : si l'utilisateur l'a déjà ouvert, New-Object rend SON PowerPoint, et
  # Quit() le fermerait avec ses présentations. On ne quitte donc que l'instance que ce script a lancée.
  $ppTournaitDeja = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
  $pp = New-Object -ComObject PowerPoint.Application
  try {
    # ReadOnly = -1, Untitled = 0, WithWindow = 0 : aucune fenêtre.
    $pr = $pp.Presentations.Open((Resolve-Path $Pptx).Path, -1, 0, 0)
    for ($i = 1; $i -le $pr.Slides.Count; $i++) {
      $png = Join-Path $Sortie "diapositive-$i.png"
      $pr.Slides.Item($i).Export($png, 'PNG', 1920, 1080)
      $images.Add($png)
    }
    $pr.Close()
  } finally {
    if (-not $ppTournaitDeja) { $pp.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
  }
}

# Une image de moins de 2 Ko est un rendu vide : l'export a échoué sans le dire.
foreach ($png in $images) {
  if (-not (Test-Path $png) -or (Get-Item $png).Length -lt 2048) { throw "Image absente ou vide : $png" }
}
# Sans UTF-8 en sortie, Windows PowerShell 5.1 abîme les accents des chemins (« synth�se »).
[Console]::OutputEncoding = [Text.Encoding]::UTF8
@{ images = $images } | ConvertTo-Json -Compress
