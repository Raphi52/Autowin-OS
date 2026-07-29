<#
.SYNOPSIS
  Surveille un crash de l'app en usage reel : mort du process, tour reste sans reponse, appel CLI en
  erreur. Complete monitor-runs.ps1 (qui suit la survie des runs) en repondant a une autre question :
  « l'app est-elle tombee, et qu'etait-elle en train de faire ? ».

.DESCRIPTION
  Constate le 2026-07-29 : un tour de chat qui EDITAIT un fichier a fait tomber l'app — port CDP
  injoignable, AUCUN journal CLI ecrit, message assistant reste vide. Sans trace, la cause est
  indevinable. Ce moniteur capture donc l'etat JUSTE AVANT la disparition du process : dernier tour
  vu, dernier journal ecrit, et si un appel etait en cours.
  N'ecrit QUE les transitions, pour rester lisible.
#>
[CmdletBinding()]
param(
  [string] $UserData = (Join-Path $env:APPDATA 'autowin-os'),
  [int] $IntervalSeconds = 5,
  [int] $DurationMinutes = 45,
  [string] $LogPath
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
if (-not $LogPath) { $LogPath = Join-Path $UserData 'monitor-crash.log' }
$stdoutRoot = Join-Path $UserData 'run-stdout'
$conversations = Join-Path $UserData 'conversations.json'
. "$PSScriptRoot\monitor-common.ps1"

function Get-AppProcesses {
  @(Get-Process -Name 'autowin-os' -ErrorAction SilentlyContinue)
}

# Dernier tour visible : un message assistant VIDE = tour en cours (ou tour mort si l'app disparait).
function Get-LastTurn {
  if (-not (Test-Path $conversations)) { return $null }
  try {
    $raw = Get-Content -Path $conversations -Raw -ErrorAction Stop
    $data = $raw | ConvertFrom-Json
    $list = if ($data -is [array]) { $data } else { $data.conversations }
    $recent = $list | Sort-Object -Property updatedAt -Descending | Select-Object -First 1
    if (-not $recent) { return $null }
    $messages = @($recent.messages)
    if ($messages.Count -eq 0) { return @{ Conv = $recent.id; Role = 'aucun'; Chars = 0 } }
    $last = $messages[$messages.Count - 1]
    return @{
      Conv  = $recent.id
      Role  = $last.role
      Chars = ([string]$last.content).Length
    }
  } catch { return $null }
}

function Get-StdoutState {
  $files = Get-StdoutFiles $stdoutRoot
  $newest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $errors = 0
  if ($newest) {
    $text = Get-Content -Path $newest.FullName -Raw -ErrorAction SilentlyContinue
    if ($text -match '"is_error"\s*:\s*true') { $errors = 1 }
  }
  return @{
    Count  = $files.Count
    Newest = if ($newest) { $newest.Name.Substring(0, [Math]::Min(12, $newest.Name.Length)) } else { '' }
    Errors = $errors
  }
}

Write-Line ("MONITOR CRASH demarre | userData=$UserData | intervalle=${IntervalSeconds}s | duree=${DurationMinutes}min")
$procs = Get-AppProcesses
Write-Line ("etat initial : {0} process autowin-os" -f $procs.Count)
$prevCount = $procs.Count
$prevPids = ($procs | ForEach-Object { $_.Id }) -join ','
$prevStdout = (Get-StdoutState).Count
$prevTurn = Get-LastTurn
if ($prevTurn) { Write-Line ("dernier tour : conv={0} role={1} {2} car" -f $prevTurn.Conv, $prevTurn.Role, $prevTurn.Chars) }

$deadline = (Get-Date).AddMinutes($DurationMinutes)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $IntervalSeconds # sleep-ok: moniteur d'observation, intervalle parametre

  $procs = Get-AppProcesses
  $pids = ($procs | ForEach-Object { $_.Id }) -join ','
  $turn = Get-LastTurn
  $stdout = Get-StdoutState

  # LE signal recherche : le process disparait. On dit ce qu'il faisait juste avant.
  if ($procs.Count -lt $prevCount) {
    Write-Line ("*** APP DISPARUE *** {0} -> {1} process (pids avant: {2})" -f $prevCount, $procs.Count, $prevPids)
    if ($prevTurn) {
      Write-Line ("    au moment de la chute : conv={0} role={1} reponse={2} car{3}" -f `
          $prevTurn.Conv, $prevTurn.Role, $prevTurn.Chars,
        $(if ($prevTurn.Role -eq 'assistant' -and $prevTurn.Chars -eq 0) { ' <-- TOUR EN COURS, reponse VIDE' } else { '' }))
    }
    Write-Line ("    journaux CLI : {0} (dernier: {1})" -f $stdout.Count, $stdout.Newest)
  }
  elseif ($procs.Count -gt $prevCount) {
    Write-Line ("app relancee : {0} -> {1} process" -f $prevCount, $procs.Count)
  }

  if ($stdout.Count -ne $prevStdout) {
    Write-Line ("nouveau journal CLI : {0} -> {1} (dernier: {2}){3}" -f `
        $prevStdout, $stdout.Count, $stdout.Newest, $(if ($stdout.Errors) { ' [is_error=true]' } else { '' }))
  }

  if ($turn -and (-not $prevTurn -or $turn.Role -ne $prevTurn.Role -or $turn.Chars -ne $prevTurn.Chars)) {
    Write-Line ("tour : conv={0} role={1} {2} car" -f $turn.Conv, $turn.Role, $turn.Chars)
  }

  $prevCount = $procs.Count
  if ($pids) { $prevPids = $pids }
  $prevStdout = $stdout.Count
  if ($turn) { $prevTurn = $turn }
}

Write-Line ("MONITOR termine | {0} process autowin-os a la fin" -f (Get-AppProcesses).Count)
exit 0
