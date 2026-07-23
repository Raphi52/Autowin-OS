param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Autowin OS.lnk')
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
$executableItem = Get-Item -LiteralPath $executable
$executableVersion = $executableItem.VersionInfo.ProductVersion
if ([string]::IsNullOrWhiteSpace($executableVersion)) {
  $executableVersion = $executableItem.VersionInfo.FileVersion
}
if ([string]::IsNullOrWhiteSpace($executableVersion)) {
  throw "L'exécutable canonique n'expose aucune version : $($executableItem.FullName)"
}
$identity = [pscustomobject]@{
  executable = $executableItem.FullName
  executableSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
  executableVersion = $executableVersion
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $identity.executable
$shortcut.WorkingDirectory = Split-Path -Parent $identity.executable
$shortcut.IconLocation = "$stableIcon,0"
$shortcut.Description = 'Autowin OS - build desktop canonique'
$shortcut.Save()

$verified = $shell.CreateShortcut($ShortcutPath)
if ($verified.TargetPath -ne $identity.executable -or $verified.IconLocation -notlike "$stableIcon,*") {
  throw "Le raccourci Bureau n'a pas été mis à jour : $ShortcutPath"
}

Write-Output "Desktop shortcut updated: $ShortcutPath -> $($identity.executable)"
$identity | ConvertTo-Json -Compress
