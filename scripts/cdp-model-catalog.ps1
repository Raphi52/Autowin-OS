param(
  [ValidateRange(1024, 65535)][int]$Port = 9223,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
$pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 3
if ($pages.PSObject.Properties['value']) { $pages = $pages.value }
$page = ($pages | Where-Object type -eq 'page' | Select-Object -First 1)
if (-not $page) { throw "Fenêtre Autowin introuvable sur le port $Port." }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(40))
$socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $cancel.Token).GetAwaiter().GetResult() | Out-Null
$script:callId = 0

function Invoke-Cdp {
  param([string]$Method, [hashtable]$Params = @{})
  $script:callId++
  $payload = @{ id = $script:callId; method = $Method; params = $Params } | ConvertTo-Json -Depth 10 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $segment = [ArraySegment[byte]]::new($bytes)
  $socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, $cancel.Token).GetAwaiter().GetResult()
  do {
    $stream = [IO.MemoryStream]::new()
    do {
      $buffer = [byte[]]::new(65536)
      $result = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)
    $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
  } while ($message.id -ne $script:callId)
  if ($message.error) { throw $message.error.message }
  return $message.result
}

function Invoke-Js([string]$Expression) {
  $result = Invoke-Cdp 'Runtime.evaluate' @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw 'Évaluation DOM en échec.' }
  return $result.result.value
}

Invoke-Js "(() => { const b=[...document.querySelectorAll('button')].find(x => /models/i.test(x.textContent||'')); b?.click(); return Boolean(b) })()" | Out-Null
$proof = $null
$deadline = (Get-Date).AddSeconds(15)
do {
  $proof = Invoke-Js "(() => ({ labels:[...document.querySelectorAll('.topology-model strong')].map(x=>x.textContent?.trim()).filter(Boolean), login:[...document.querySelectorAll('button')].some(x=>x.textContent?.includes('Connecter Gemini avec Google')) }))()"
  if ($proof.login -and ($proof.labels | Where-Object { $_ -match '^Gemini 3\.5 Flash' })) { break }
  Start-Sleep -Milliseconds 150
} while ((Get-Date) -lt $deadline)
if (-not $proof.login -or -not ($proof.labels | Where-Object { $_ -match '^Gemini 3\.5 Flash' })) {
  throw "Preuve Gemini absente : $($proof | ConvertTo-Json -Compress)"
}
Invoke-Js "(() => { const title=[...document.querySelectorAll('.topology-model strong')].find(x => /^Gemini 3.5 Flash/.test(x.textContent||'')); title?.closest('button')?.scrollIntoView({block:'center'}); return Boolean(title) })()" | Out-Null
$shot = Invoke-Cdp 'Page.captureScreenshot' @{ format = 'png'; fromSurface = $true }
$directory = Split-Path -Parent $Output
if ($directory) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
[IO.File]::WriteAllBytes($Output, [Convert]::FromBase64String($shot.data))
$socket.Dispose()
@{ output = $Output; labels = $proof.labels; login = $proof.login } | ConvertTo-Json -Depth 4 -Compress
