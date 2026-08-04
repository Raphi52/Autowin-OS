$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "Assertion failed: $Message" }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$devCommand = $manifest.scripts.dev
Assert-True ($devCommand -eq 'electron-vite dev --watch') 'dev must delegate one watch loop to electron-vite'
Assert-True (($devCommand -split '--watch').Count -eq 2) 'dev must contain exactly one --watch flag'

$electronVite = Join-Path $projectRoot 'node_modules\.bin\electron-vite.cmd'
$help = & $electronVite dev --help 2>&1 | Out-String
Assert-True ($LASTEXITCODE -eq 0) 'electron-vite dev --help must succeed'
Assert-True ($help -match '--watch.*main process or preload script modules') `
  '--watch must cover main and preload; renderer remains on its dev-server hot update path'

$shortcutSource = Get-Content -Raw (Join-Path $PSScriptRoot 'create-dev-shortcut.ps1')
Assert-True ($shortcutSource -match '\$shortcut\.Arguments\s*=.*-WindowStyle Hidden') `
  'the desktop shortcut must hide its bootstrap PowerShell window'

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "autowin-launch-dev-test-$PID"
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
Set-Content -LiteralPath (Join-Path $fixtureRoot 'package.json') -Value '{}'

$script:processMode = 'existing'
$script:startCalls = @()
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($script:processMode -eq 'existing') {
    return [pscustomobject]@{
      ProcessId = 4242
      CommandLine = 'cmd.exe /c title Autowin OS Dev && npm run dev'
    }
  }
  return $null
}
function Start-Process {
  param(
    [string]$FilePath,
    [object[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$WindowStyle
  )
  $script:startCalls += [pscustomobject]@{
    FilePath = $FilePath
    ArgumentList = $ArgumentList
    WorkingDirectory = $WorkingDirectory
    WindowStyle = $WindowStyle
  }
}

try {
  $duplicateError = $null
  try {
    . (Join-Path $PSScriptRoot 'launch-dev.ps1') -ProjectRoot $fixtureRoot
  } catch {
    $duplicateError = $_
  }
  Assert-True ($null -ne $duplicateError) 'a second dev terminal must be rejected'
  Assert-True ($duplicateError.Exception.Message -match '4242') 'duplicate rejection must identify the existing PID'
  Assert-True ($script:startCalls.Count -eq 0) 'duplicate rejection must not launch another terminal'

  $script:processMode = 'none'
  . (Join-Path $PSScriptRoot 'launch-dev.ps1') -ProjectRoot $fixtureRoot
  Assert-True ($script:startCalls.Count -eq 1) 'normal launch must delegate exactly once'
  Assert-True ($script:startCalls[0].ArgumentList[0] -eq '/c') `
    'cmd must exit cleanly with electron-vite instead of remaining orphaned via /k'
  Assert-True ($script:startCalls[0].ArgumentList[1] -eq 'title Autowin OS Dev && npm run dev') `
    'the delegated command must remain the unique marked dev loop'
  Assert-True ($script:startCalls[0].WorkingDirectory -eq $fixtureRoot) 'the dev loop must start in the requested project'
  Assert-True ($script:startCalls[0].WindowStyle -eq 'Hidden') `
    'the long-lived dev loop must never occupy Alt+Tab or the taskbar'
} finally {
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'PASS launch-dev watcher contract: renderer HMR, main/preload watch, single hidden launch, clean cmd exit'
