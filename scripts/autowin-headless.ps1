param(
  [ValidateSet('Start', 'Status', 'Stop')][string]$Action = 'Start',
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [ValidateRange(1024, 65535)][int]$Port = 9240,
  [string]$Executable = 'C:\Amitel\Autowin OS\dist\win-unpacked\autowin-os.exe',
  [string]$InstancesRoot = 'C:\Amitel\Autowin OS\Audit\headless-instances'
)

$ErrorActionPreference = 'Stop'
$instanceRoot = Join-Path $InstancesRoot $InstanceId
$userData = Join-Path $instanceRoot 'user-data'
$appData = Join-Path $instanceRoot 'appdata'
$stateFile = Join-Path $instanceRoot 'instance.json'

function Read-ExecutableIdentity {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    return [pscustomobject]@{
      executable = $Executable
      executableSha256 = $null
      executableVersion = $null
    }
  }
  $item = Get-Item -LiteralPath $Executable
  $version = $item.VersionInfo.ProductVersion
  if ([string]::IsNullOrWhiteSpace($version)) { $version = $item.VersionInfo.FileVersion }
  return [pscustomobject]@{
    executable = $item.FullName
    executableSha256 = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
    executableVersion = $version
  }
}

function Read-OwnedProcess {
  $state = Read-InstanceState
  if ($null -eq $state) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  $requiredArguments = @("--remote-debugging-port=$Port", "--user-data-dir=$userData", '--isolated-test-instance', '--headless-test-instance')
  if ($process.ExecutablePath -ne $identity.executable -or $requiredArguments.Where({ -not $process.CommandLine.Contains($_) }).Count -gt 0) {
    throw "Le PID $($state.pid) ne porte pas l'identité headless complète de '$InstanceId'. Arrêt refusé."
  }
  return $process
}

$identity = Read-ExecutableIdentity

function Read-InstanceState {
  if (-not (Test-Path -LiteralPath $stateFile)) { return $null }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ($state.executable -ne $identity.executable -or $state.port -ne $Port -or $state.userData -ne $userData) {
    throw "L'identité persistée de '$InstanceId' ne correspond pas à la commande demandée."
  }
  return $state
}

if ($Action -eq 'Stop') {
  $owned = Read-OwnedProcess
  if ($null -ne $owned) { Stop-Process -Id $owned.ProcessId -Force }
  if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile -Force }
  [pscustomobject]@{ instanceId = $InstanceId; status = 'stopped'; port = $Port; executable = $identity.executable; executableSha256 = $identity.executableSha256; executableVersion = $identity.executableVersion } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'Status') {
  $state = Read-InstanceState
  $owned = Read-OwnedProcess
  try { $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 1 } catch { $pages = $null }
  $launchSha256 = if ($state -and $state.executableSha256) { $state.executableSha256 } else { $identity.executableSha256 }
  $launchVersion = if ($state -and $state.executableVersion) { $state.executableVersion } else { $identity.executableVersion }
  $executableMissing = $null -ne $state -and -not (Test-Path -LiteralPath $identity.executable -PathType Leaf)
  $executableDrift = if ($executableMissing) { $true } elseif ($launchSha256 -and $identity.executableSha256) { $launchSha256 -ne $identity.executableSha256 } else { $null }
  $executableDriftReason = if ($executableMissing) { 'missing' } elseif ($executableDrift) { 'sha256-mismatch' } else { $null }
  [pscustomobject]@{ instanceId = $InstanceId; running = $null -ne $owned; cdpReady = $null -ne $pages; pid = if ($owned) { $owned.ProcessId } else { $null }; port = $Port; executable = if ($state) { $state.executable } else { $identity.executable }; executableSha256 = $launchSha256; executableVersion = $launchVersion; executableOnDiskSha256 = $identity.executableSha256; executableOnDiskVersion = $identity.executableVersion; executableDrift = $executableDrift; executableDriftReason = $executableDriftReason } | ConvertTo-Json -Compress
  exit $(if ($owned -and $pages) { 0 } else { 1 })
}

if (-not (Test-Path -LiteralPath $Executable)) { throw "Binaire introuvable : $Executable" }
if ([string]::IsNullOrWhiteSpace($identity.executableVersion)) { throw "Le binaire headless n'expose aucune version : $($identity.executable)" }
if ($null -ne (Read-OwnedProcess)) { throw "L'instance '$InstanceId' est déjà active." }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Le port CDP $Port est déjà occupé." }
New-Item -ItemType Directory -Path $userData, $appData -Force | Out-Null
$env:APPDATA = $appData
$process = Start-Process -FilePath $identity.executable -ArgumentList @(
  "--remote-debugging-port=$Port",
  "`"--user-data-dir=$userData`"",
  '--isolated-test-instance',
  '--headless-test-instance'
) -WorkingDirectory (Split-Path -Parent $identity.executable) -WindowStyle Hidden -PassThru
try {
  $launchedIdentity = Read-ExecutableIdentity
  if ($launchedIdentity.executable -ne $identity.executable -or $launchedIdentity.executableSha256 -ne $identity.executableSha256 -or $launchedIdentity.executableVersion -ne $identity.executableVersion) {
    throw "L'identité du binaire a changé pendant le lancement de '$InstanceId'."
  }
} catch {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw
}
@{ pid = $process.Id; executable = $launchedIdentity.executable; executableSha256 = $launchedIdentity.executableSha256; executableVersion = $launchedIdentity.executableVersion; port = $Port; userData = $userData } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8

$deadline = (Get-Date).AddSeconds(20)
do {
  if ($process.HasExited) { throw "Autowin OS s'est arrêté avant que CDP soit prêt (exit $($process.ExitCode))." }
  try { $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 1 } catch { $pages = $null }
  if ($pages) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id }
    if (-not $listener) { throw "Le endpoint CDP $Port n'appartient pas au PID $($process.Id)." }
    [pscustomobject]@{ instanceId = $InstanceId; status = 'ready'; pid = $process.Id; port = $Port; userData = $userData; webSocketDebuggerUrl = $pages[0].webSocketDebuggerUrl; executable = $launchedIdentity.executable; executableSha256 = $launchedIdentity.executableSha256; executableVersion = $launchedIdentity.executableVersion } | ConvertTo-Json -Compress
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
throw "CDP indisponible sur le port $Port après 20 secondes."
