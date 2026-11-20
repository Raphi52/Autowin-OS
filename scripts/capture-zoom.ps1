# AGRANDIR une zone d'une capture (PNG) pour la lire de pres.
#
#   powershell -NoProfile -File scripts/capture-zoom.ps1 -Image <capture.png> `
#     -X 20 -Y 150 -Largeur 400 -Hauteur 300 [-Facteur 3] [-Lisse] [-Output <zoom.png>]
#
# Pourquoi un outil : une capture de bureau cache (hdesk-observe.ps1,
# bureau_cache_observer) se lit a l'echelle de l'ecran ; un filet de 1 a 3 px
# (lisere d'un arbre, bordure, alignement de deux cartes) s'y devine mais ne
# se VERIFIE pas. Recadrer et agrandir se faisait a la main a chaque fois.
#
# Les coordonnees sont les pixels de la capture (les memes que bureau_cache_agir).
# Par defaut l'agrandissement est au PLUS PROCHE VOISIN : chaque pixel devient un
# carre net, on compte les pixels d'un filet. -Lisse lisse l'image (lecture de texte).
# La zone est rognee aux bords de l'image. Sortie : JSON {ok, sortie, largeur, hauteur}.
# Codes : 0 = ecrit, 1 = image absente ou zone vide.
param(
  [Parameter(Mandatory = $true)][string]$Image,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$Largeur,
  [Parameter(Mandatory = $true)][int]$Hauteur,
  [ValidateRange(1, 8)][int]$Facteur = 2,
  [switch]$Lisse,
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $Image)) {
  [pscustomobject]@{ ok = $false; erreur = "Image absente : $Image" } | ConvertTo-Json -Compress
  exit 1
}
$source = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Image).Path)
try {
  $x0 = [Math]::Max(0, $X); $y0 = [Math]::Max(0, $Y)
  $x1 = [Math]::Min($source.Width, $X + $Largeur); $y1 = [Math]::Min($source.Height, $Y + $Hauteur)
  if ($x1 -le $x0 -or $y1 -le $y0) {
    [pscustomobject]@{ ok = $false; erreur = "Zone vide : l'image fait $($source.Width)x$($source.Height)" } | ConvertTo-Json -Compress
    exit 1
  }
  $l = $x1 - $x0; $h = $y1 - $y0
  $sortie = New-Object System.Drawing.Bitmap ($l * $Facteur), ($h * $Facteur)
  $g = [System.Drawing.Graphics]::FromImage($sortie)
  try {
    $g.InterpolationMode = if ($Lisse) { [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic }
                           else { [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor }
    # Half : sans lui, le plus proche voisin decale l'image d'un demi-pixel source.
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, ($l * $Facteur), ($h * $Facteur)),
                 (New-Object System.Drawing.Rectangle $x0, $y0, $l, $h), [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path ([System.IO.Path]::GetDirectoryName((Resolve-Path -LiteralPath $Image).Path)) `
      ([System.IO.Path]::GetFileNameWithoutExtension($Image) + "-zoom-$x0-$y0.png")
  }
  $sortie.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  $sortie.Dispose()
  [pscustomobject]@{ ok = $true; sortie = $Output; largeur = $l * $Facteur; hauteur = $h * $Facteur } | ConvertTo-Json -Compress
} finally { $source.Dispose() }
