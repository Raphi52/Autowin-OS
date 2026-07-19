param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$png = Join-Path $ProjectRoot 'resources\autowin-os-dev.png'
$ico = Join-Path $ProjectRoot 'resources\autowin-os-dev.ico'
$launcher = Join-Path $ProjectRoot 'scripts\launch-dev.ps1'
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
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.IconLocation = "$ico,0"
$shortcut.Description = 'Autowin OS - version Dev'
$shortcut.Save()

$verified = $shell.CreateShortcut($shortcutPath)
if ($verified.IconLocation -notlike "$ico,*" -or $verified.Arguments -notlike '*launch-dev.ps1*') {
  throw "Le raccourci Dev n'a pas été mis à jour : $shortcutPath"
}
Write-Output "Dev shortcut updated: $shortcutPath -> $launcher"
