<#
.SYNOPSIS
  Surveille en continu la survie des runs (mode detache) : journaux de sortie brute des CLI et
  journaux de tour. Sert a voir, en USAGE REEL, que les CLI ecrivent bien dans leur fichier et
  quels tours restent inacheves (donc repris au prochain demarrage).

.DESCRIPTION
  Echantillonne a intervalle regulier et n'ecrit QUE les changements (une ligne par transition) :
  nouveau journal, journal qui grossit, tour termine, tour inacheve. Chaque ligne est horodatee.
#>
[CmdletBinding()]
param(
  [string] $UserData = (Join-Path $env:APPDATA 'autowin-os'),
  [int] $IntervalSeconds = 10,
  [int] $DurationMinutes = 60,
  [string] $LogPath
)

$ErrorActionPreference = 'Stop'
# Console en UTF-8 : sans ca les accents des messages sortent en mojibake quand le monitor est lu
# depuis un terminal non-UTF8 (le fichier log, lui, est toujours ecrit en utf8).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$stdoutRoot = Join-Path $UserData 'run-stdout'
$turnRoot = Join-Path $UserData 'turn-journals'
if (-not $LogPath) { $LogPath = Join-Path $UserData 'monitor-runs.log' }
. "$PSScriptRoot\monitor-common.ps1"

function Get-StdoutSizes {
  $map = @{}
  Get-StdoutFiles $stdoutRoot | ForEach-Object { $map[$_.Name] = $_.Length }
  return $map
}

# Un tour est INACHEVE tant que son journal ne porte pas d'evenement de fin ('done'/'error').
function Get-TurnStates {
  if (-not (Test-Path $turnRoot)) { return @{} }
  $map = @{}
  Get-ChildItem -Path $turnRoot -Filter '*.jsonl' -File -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object {
      $text = Get-Content -Path $_.FullName -Raw -ErrorAction SilentlyContinue
      $finished = $text -match '"kind"\s*:\s*"(done|error)"'
      $key = '{0}/{1}' -f $_.Directory.Name, $_.BaseName
      $map[$key] = @{ Finished = $finished; Size = $_.Length }
    }
  return $map
}

Write-Line ("MONITOR demarre | userData=$UserData | intervalle=${IntervalSeconds}s | duree=${DurationMinutes}min")
$previousSizes = Get-StdoutSizes
$previousTurns = Get-TurnStates
Write-Line ("etat initial : {0} journal(aux) de sortie, {1} tour(s) dont {2} inacheve(s)" -f `
    $previousSizes.Count, $previousTurns.Count, (@($previousTurns.Values | Where-Object { -not $_.Finished }).Count))

$deadline = (Get-Date).AddMinutes($DurationMinutes)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $IntervalSeconds # sleep-ok: monitor d'observation delibere, intervalle parametre

  $sizes = Get-StdoutSizes
  foreach ($name in $sizes.Keys) {
    if (-not $previousSizes.ContainsKey($name)) {
      Write-Line ("NOUVEAU journal de sortie : $name ({0} o) -> un CLI ecrit dans son fichier" -f $sizes[$name])
    }
    elseif ($sizes[$name] -ne $previousSizes[$name]) {
      Write-Line ("CROISSANCE $name : {0} -> {1} o (+{2})" -f $previousSizes[$name], $sizes[$name], ($sizes[$name] - $previousSizes[$name]))
    }
  }

  $turns = Get-TurnStates
  foreach ($key in $turns.Keys) {
    $now = $turns[$key]
    $before = $previousTurns[$key]
    if ($null -eq $before) {
      Write-Line ("NOUVEAU tour $key (inacheve=$(-not $now.Finished))")
    }
    elseif ($now.Finished -and -not $before.Finished) {
      Write-Line ("tour TERMINE $key -> ne sera pas repris")
    }
    elseif ($now.Size -ne $before.Size) {
      Write-Line ("tour ACTIF $key : {0} -> {1} o" -f $before.Size, $now.Size)
    }
  }
  foreach ($key in $previousTurns.Keys) {
    if (-not $turns.ContainsKey($key)) { Write-Line ("tour PURGE $key (GC du journal)") }
  }

  $previousSizes = $sizes
  $previousTurns = $turns
}

$pending = @($previousTurns.Values | Where-Object { -not $_.Finished }).Count
Write-Line ("MONITOR termine | {0} tour(s) inacheve(s) -> autant seront REPRIS au prochain demarrage" -f $pending)
exit 0
