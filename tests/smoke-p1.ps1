# smoke-p1.ps1 -- signal rejouable Phase 1 (+ modules P2/P3/P4). ASCII-only.
# Prouve: suite unitaire complete verte + build complet exit 0 (integration facade + IPC).
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $PSScriptRoot
Set-Location $proj
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$fail = 0

Write-Host "=== [1/2] Suite unitaire complete (13 modules) ==="
& npm test 2>&1 | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) { Write-Host "TESTS KO"; $fail = 1 } else { Write-Host "TESTS OK" }

Write-Host ""
Write-Host "=== [2/2] Build complet (typecheck + bundle, integration facade+IPC) ==="
& npm run build 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD KO"; $fail = 1 } else { Write-Host "BUILD OK" }

Write-Host ""
if ($fail -eq 0) { Write-Host "SMOKE P1 VERT: suite + build OK."; exit 0 } else { Write-Host "SMOKE P1 ROUGE."; exit 1 }
