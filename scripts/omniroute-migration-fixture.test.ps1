param(
  [ValidateRange(1024, 65535)][int]$Port = 20129
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("autowin-omniroute-terrain-" + [guid]::NewGuid().ToString('N'))
$stateFile = Join-Path $testRoot 'requests.jsonl'
$token = 'fixture-secret-must-never-be-logged'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

$fixture = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @(
  'scripts\omniroute-migration-fixture.mjs',
  '--port', $Port,
  '--state-file', "`"$stateFile`"",
  '--token', $token
) -WorkingDirectory $root -WindowStyle Hidden -PassThru

try {
  $deadline = (Get-Date).AddSeconds(10)
  do {
    try {
      $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__fixture/state" -TimeoutSec 1
    } catch {
      $state = $null
    }
    if (-not $state) { Start-Sleep -Milliseconds 100 }
  } while (-not $state -and (Get-Date) -lt $deadline)
  if (-not $state) { throw 'fixture-ready-timeout' }

  $negativeRejected = $false
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/v1/models" -Headers @{ Authorization = 'Bearer hostile-secret' } -TimeoutSec 2 | Out-Null
  } catch {
    $negativeRejected = $_.Exception.Response.StatusCode.value__ -eq 401
  }
  if (-not $negativeRejected) { throw 'negative-control-auth-did-not-fail' }

  $headers = @{ Authorization = "Bearer $token" }
  $models = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/models" -Headers $headers -TimeoutSec 2
  if ($models.data.Count -lt 3) { throw 'models-contract-failed' }

  $chatHeaders = @{
    Authorization = "Bearer $token"
    'X-Request-Id' = 'terrain-proof-1'
  }
  $payload = @{
    model = 'auto/coding'
    stream = $true
    messages = @(@{ role = 'user'; content = 'sentinel' })
  } | ConvertTo-Json -Depth 5
  $chat = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/v1/chat/completions" -Method Post -Headers $chatHeaders -ContentType 'application/json' -Body $payload -TimeoutSec 2
  $deltaCount = ([regex]::Matches($chat.Content, '"content":')).Count
  if ($deltaCount -ne 3 -or -not $chat.Content.Contains('data: [DONE]')) { throw 'sse-contract-failed' }
  if ($chat.Headers['X-Request-Id'] -ne 'terrain-proof-1') { throw 'correlation-header-missing' }

  $journal = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8
  if (-not $journal.Contains('"kind":"chat"')) { throw 'journal-empty' }
  if ($journal.Contains($token) -or $journal.Contains('hostile-secret')) { throw 'secret-leaked' }

  [pscustomobject]@{
    status = 'PASS'
    models = $models.data.Count
    sseDeltas = $deltaCount
    secretsFound = 0
  } | ConvertTo-Json -Compress
} finally {
  $owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($fixture.Id)" -ErrorAction SilentlyContinue
  if ($owned -and $owned.ExecutablePath -eq 'C:\Program Files\nodejs\node.exe' -and $owned.CommandLine.Contains('omniroute-migration-fixture.mjs')) {
    Stop-Process -Id $fixture.Id -Force
  }
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
  $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTestRoot.StartsWith($resolvedTemp) -and $resolvedTestRoot.Contains('autowin-omniroute-terrain-')) {
    [System.IO.Directory]::Delete($resolvedTestRoot, $true)
  }
}
