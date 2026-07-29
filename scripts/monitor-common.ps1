<#
.SYNOPSIS
  Mecanique commune aux moniteurs monitor-runs.ps1 (survie des runs) et monitor-crash.ps1
  (crash de l'app) : logging horodate + liste des journaux de sortie brute des CLI.

.DESCRIPTION
  A dot-sourcer depuis le script appelant : . "$PSScriptRoot\monitor-common.ps1"
  Le script appelant doit definir $LogPath AVANT de dot-sourcer ce fichier (Write-Line
  capture $LogPath par portee, comme dot-sourcer met ce fichier dans la portee de l'appelant).
#>

function Write-Line([string] $Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Output $line
  Add-Content -Path $LogPath -Value $line -Encoding utf8
}

# Journaux de sortie brute des CLI (*.stdout.jsonl) sous $StdoutRoot. Chemin absent -> liste vide.
function Get-StdoutFiles([string] $StdoutRoot) {
  if (-not (Test-Path $StdoutRoot)) { return @() }
  return @(Get-ChildItem -Path $StdoutRoot -Filter '*.stdout.jsonl' -File -ErrorAction SilentlyContinue)
}
