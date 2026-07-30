param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Arm", "Disarm", "Inspect")]
  [string]$Action,

  [string]$TaskName = "Autowin OS - Prompt Relay",
  [string]$ExecutablePath = "",
  [long]$ScheduledForEpochMs = 0,
  [string]$OccurrenceId = "",
  [string]$LaunchArgumentsB64 = ""
)

$ErrorActionPreference = "Stop"

function Write-RelayState {
  param(
    [Nullable[long]]$ScheduledFor,
    [bool]$Available = $true,
    [string]$ErrorMessage = ""
  )
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $settings = if ($task) { $task.Settings } else { $null }
  [ordered]@{
    available = $Available
    scheduledFor = $ScheduledFor
    wakeToRun = if ($settings) { [bool]$settings.WakeToRun } else { $true }
    startWhenAvailable = if ($settings) { [bool]$settings.StartWhenAvailable } else { $false }
    multipleInstances = if ($settings) { [string]$settings.MultipleInstances } else { "IgnoreNew" }
    error = if ($ErrorMessage) { $ErrorMessage } else { $null }
  } | ConvertTo-Json -Compress
}

if ($Action -eq "Disarm") {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Write-RelayState -ScheduledFor $null
  exit 0
}

if ($Action -eq "Inspect") {
  Write-RelayState -ScheduledFor $null
  exit 0
}

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Executable Autowin introuvable: $ExecutablePath"
}
if ($ScheduledForEpochMs -le 0 -or [string]::IsNullOrWhiteSpace($OccurrenceId)) {
  throw "ScheduledForEpochMs et OccurrenceId sont obligatoires pour Arm."
}

$at = [DateTimeOffset]::FromUnixTimeMilliseconds($ScheduledForEpochMs).LocalDateTime
$bytes = [Text.Encoding]::UTF8.GetBytes($OccurrenceId)
$encodedOccurrence = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$launchArguments = @()
if (-not [string]::IsNullOrWhiteSpace($LaunchArgumentsB64)) {
  $normalized = $LaunchArgumentsB64.Replace("-", "+").Replace("_", "/")
  while ($normalized.Length % 4 -ne 0) { $normalized += "=" }
  $launchJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($normalized))
  $decodedLaunchArguments = ConvertFrom-Json $launchJson
  foreach ($launchArgument in $decodedLaunchArguments) {
    $launchArguments += [string]$launchArgument
  }
}
function Quote-TaskArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}
$argumentParts = @(
  "--autowin-task-dispatch",
  "--autowin-task-occurrence-b64",
  $encodedOccurrence
) + $launchArguments
$arguments = ($argumentParts | ForEach-Object { Quote-TaskArgument ([string]$_) }) -join " "
$taskAction = New-ScheduledTaskAction -Execute $ExecutablePath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At $at
$settings = New-ScheduledTaskSettingsSet `
  -WakeToRun `
  -StartWhenAvailable:$false `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12)
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited
$definition = New-ScheduledTask `
  -Action $taskAction `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal
Register-ScheduledTask -TaskName $TaskName -InputObject $definition -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName
if (
  -not [bool]$registered.Settings.WakeToRun -or
  [bool]$registered.Settings.StartWhenAvailable -or
  [string]$registered.Settings.MultipleInstances -ne "IgnoreNew"
) {
  throw "La relecture Task Scheduler ne respecte pas le contrat WakeToRun/no-catch-up/IgnoreNew."
}

Write-RelayState -ScheduledFor $ScheduledForEpochMs
