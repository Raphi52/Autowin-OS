param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$executable = Join-Path $ProjectRoot 'dist\win-unpacked\autowin-os.exe'
$stableIcon = Join-Path $ProjectRoot 'build\icon.ico'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Package introuvable : $executable. Lance d'abord npm run build:desktop."
}
if (-not (Test-Path -LiteralPath $stableIcon -PathType Leaf)) {
  throw "Icône canonique introuvable : $stableIcon"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Autowin OS.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = Split-Path -Parent $executable
$shortcut.IconLocation = "$stableIcon,0"
$shortcut.Description = 'Autowin OS - build desktop canonique'
$shortcut.Save()

$verified = $shell.CreateShortcut($shortcutPath)
if ($verified.TargetPath -ne $executable -or $verified.IconLocation -notlike "$stableIcon,*") {
  throw "Le raccourci Bureau n'a pas été mis à jour : $shortcutPath"
}

Write-Output "Desktop shortcut updated: $shortcutPath -> $executable"
