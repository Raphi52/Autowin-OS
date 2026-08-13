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
if (-not (Test-Path -LiteralPath $png -PathType Leaf)) { throw "Icône Dev introuvable : $png" }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Lanceur Dev introuvable : $launcher" }


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
$shortcut.IconLocation = "$ico,0"
$shortcut.Description = 'Autowin OS - version Dev'
$shortcut.Save()

$verified = $shell.CreateShortcut($shortcutPath)
if ($verified.IconLocation -notlike "$ico,*" -or $verified.Arguments -notlike '*launch_dev.py*') {
  throw "Le raccourci Dev n'a pas été mis à jour : $shortcutPath"
}
# `pythonw`/`pyw` : les deux sont graphiques. `python.exe` ou `py.exe` NON — les accepter
# reintroduirait la console que tout ce mécanisme sert à éviter.
if ($verified.TargetPath -notmatch '(pyw|pythonw)\.exe$') {
  throw "Le raccourci Dev doit viser un Python GRAPHIQUE (pyw/pythonw) : $($verified.TargetPath)"
}
Write-Output "Dev shortcut updated: $shortcutPath -> $interpreteur -> $launcher"
