param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$png = Join-Path $ProjectRoot 'resources\autowin-os-dev.png'
$ico = Join-Path $ProjectRoot 'resources\autowin-os-dev.ico'
$launcher = Join-Path $ProjectRoot 'scripts\launch_dev.py'
# Interpreteur GRAPHIQUE, resolu dans un ordre delibere :
#   1. un CPython EMBARQUE livre avec le depot, s'il existe (decision `python-runtime` du Brain :
#      « CPython embarque, Windows x64 ») — aucune dependance exterieure ;
#   2. `pyw.exe`, le lanceur officiel Python, independant de tout venv ;
#   3. `pythonw.exe` du PATH en DERNIER recours : sur ce poste il pointe sur le venv de Hermes, et
#      faire dependre le lanceur d'Autowin d'un autre produit serait une panne en attente.
$embarque = Join-Path $ProjectRoot 'resources\python\pythonw.exe'
$interpreteur = if (Test-Path -LiteralPath $embarque -PathType Leaf) { $embarque }
  else {
    $officiel = Get-Command pyw.exe -ErrorAction SilentlyContinue
    if ($officiel) { $officiel.Source }
    else {
      $secours = Get-Command pythonw.exe -ErrorAction SilentlyContinue
      if ($secours) { $secours.Source } else { throw "Aucun interpreteur Python graphique (pyw.exe) trouve." }
    }
  }
if (-not (Test-Path -LiteralPath $png -PathType Leaf) -and -not (Test-Path -LiteralPath $ico -PathType Leaf)) { throw "Icône Dev introuvable : $png" }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Lanceur Dev introuvable : $launcher" }


# ICO REUTILISE tel quel s il existe deja.
#
# MESURE du 2026-09-07 (conv-335) : ce script reconstruisait TOUJOURS l ico en reechantillonnant le
# seul PNG 512px. Or l ico du depot porte un dessin NATIF par taille (16 a 256 px), rendu par
# scripts/logo_anneau.py : reechantillonner le 512 rend les petits cadres flous. Le fichier livre est
# donc la source de verite ; la reconstruction n est plus qu un SECOURS quand il manque. Pour changer
# le logo : py -3 scripts/logo_anneau.py (il reecrit tous les PNG, ICO, ICNS et SVG du produit).
if (Test-Path -LiteralPath $ico -PathType Leaf) {
  Write-Host ('ICO existant reutilise (aucune reconstruction) : ' + $ico)
} else {

# ICO multi-tailles : Windows choisit l'image native au lieu de flouter un unique 256px.
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile($png)
try {
  $frames = foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
    $canvas = New-Object Drawing.Bitmap $size, $size
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $pngStream = New-Object IO.MemoryStream
    try {
      $canvas.Save($pngStream, [Drawing.Imaging.ImageFormat]::Png)
      [PSCustomObject]@{ Size = $size; Bytes = $pngStream.ToArray() }
    } finally {
      $pngStream.Dispose()
      $graphics.Dispose()
      $canvas.Dispose()
    }
  }
} finally {
  $source.Dispose()
}

$stream = [IO.File]::Open($ico, [IO.FileMode]::Create, [IO.FileAccess]::Write)
try {
  $writer = New-Object IO.BinaryWriter($stream)
  $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$frames.Count)
  $offset = 6 + (16 * $frames.Count)
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([Byte]$dimension); $writer.Write([Byte]$dimension); $writer.Write([Byte]0); $writer.Write([Byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frame.Bytes.Length); $writer.Write([UInt32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach ($frame in $frames) { $writer.Write($frame.Bytes) }
  $writer.Flush()
} finally {
  $stream.Dispose()
}

}

# ICONE A NOM VERSIONNE. Mesure du 2026-10-11 (conv-266) : le logo anneau ecrit SOUS LE MEME CHEMIN
# que l'ancien atome, l'Explorateur dessinait toujours l'atome sur le Bureau (il range ses icones par
# chemin) ; le meme raccourci pointe vers un chemin NEUF a montre l'anneau aussitot. Le raccourci vise
# donc une copie dont le nom porte l'empreinte du contenu. MEME REGLE que src/main/raccourci-demarrer-dev.ts
# (`cheminIconeVersionnee`) et scripts/logo_anneau.py (`icone_versionnee`) : SHA-256, 12 premiers hexa.
$empreinte = (Get-FileHash -LiteralPath $ico -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
$dossierIcones = Join-Path $env:LOCALAPPDATA 'autowin-os\icones'
New-Item -ItemType Directory -Force -Path $dossierIcones | Out-Null
$icoVersionnee = Join-Path $dossierIcones ("{0}-{1}.ico" -f [IO.Path]::GetFileNameWithoutExtension($ico), $empreinte)
if (-not (Test-Path -LiteralPath $icoVersionnee -PathType Leaf)) { Copy-Item -LiteralPath $ico -Destination $icoVersionnee }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Autowin OS Dev.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
# CIBLE = un interpreteur Python GRAPHIQUE (`pyw.exe`), donc AUCUNE console en haut de la chaîne.
# C'est la seule contrainte que l'ancien duo VBS+PowerShell servait : `powershell.exe` est une
# application CONSOLE, Windows lui en alloue une, Windows 11 la confie a Windows Terminal, et Windows
# Terminal IGNORE le SW_HIDE de `-WindowStyle Hidden` (fenêtre visible 242 ms, mesuré le 2026-08-05).
# `pyw.exe` etant graphique, la contrainte est satisfaite par la cible elle-même : le VBS n'a plus
# de raison d'être, et la chaîne passe de cinq maillons à deux.
$shortcut.TargetPath = $interpreteur
$shortcut.Arguments = "`"$launcher`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.IconLocation = "$icoVersionnee,0"
$shortcut.Description = 'Autowin OS - version Dev'
$shortcut.Save()

$verified = $shell.CreateShortcut($shortcutPath)
if ($verified.IconLocation -notlike "$icoVersionnee,*" -or $verified.Arguments -notlike '*launch_dev.py*') {
  throw "Le raccourci Dev n'a pas été mis à jour : $shortcutPath"
}
# `pythonw`/`pyw` : les deux sont graphiques. `python.exe` ou `py.exe` NON — les accepter
# reintroduirait la console que tout ce mécanisme sert à éviter.
if ($verified.TargetPath -notmatch '(pyw|pythonw)\.exe$') {
  throw "Le raccourci Dev doit viser un Python GRAPHIQUE (pyw/pythonw) : $($verified.TargetPath)"
}
Write-Output "Dev shortcut updated: $shortcutPath -> $interpreteur -> $launcher"
