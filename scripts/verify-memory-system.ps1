param(
    [switch]$SkipFull,
    [switch]$SkipUi
)

$ErrorActionPreference = 'Stop'
$autowinRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hermesRoot = 'C:\Users\raphael.vilain\Hermes-Brain'
$brainRoot = '\\ged2\rig\Projets IA\Amitel Brain'
$python = Join-Path $env:LOCALAPPDATA 'AmitelBrain\.venv\Scripts\python.exe'
$runRoot = Join-Path $autowinRoot 'Audit\workspaces\019f884e-ab2c-7932-aaed-e715595a4c11\perfect-memory-system-workspace'

function Invoke-NativeStep {
    param([string]$Name, [scriptblock]$Command)
    Write-Host "`n[$Name]"
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

foreach ($required in @($hermesRoot, $brainRoot, $python)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required path unavailable: $required" }
}

$oldPythonPath = $env:PYTHONPATH
$oldNoByteCode = $env:PYTHONDONTWRITEBYTECODE
try {
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    $env:PYTHONDONTWRITEBYTECODE = '1'

    Push-Location $autowinRoot
    try {
        Invoke-NativeStep 'Autowin memory tests' {
            & npx vitest run `
                src/main/brain-protocol.test.ts `
                src/main/brain-retrieval.test.ts `
                src/main/brain-query-command.test.ts `
                src/main/brain-remember.test.ts `
                src/main/session-memory-echo.test.ts `
                src/main/brain-corpus-scope.test.ts `
                src/main/amitel-context.test.ts `
                src/main/brain-server-launch.test.ts `
                src/main/viz/fs-brains.test.ts `
                src/renderer/src/components/GraphView.refresh.test.tsx
        }
        Invoke-NativeStep 'Autowin typecheck' { & npm run typecheck }
    } finally {
        Pop-Location
    }

    Push-Location $hermesRoot
    try {
        Invoke-NativeStep 'Hermes Brain tooling tests' {
            & $python -B -m unittest discover -s tooling/tests -p 'test_*.py' -v
        }
        Invoke-NativeStep 'Hermes Brain integration tests' {
            & $python -B -m unittest discover -s tests -p 'test_*.py' -v
        }
        $eval = Join-Path $hermesRoot 'tooling\brain_eval.py'
        $cases = Join-Path $hermesRoot 'tooling\eval\rag-golden.json'
        if (-not (Test-Path -LiteralPath $eval) -or -not (Test-Path -LiteralPath $cases)) {
            throw 'Canonical Hermes Brain benchmark is not mounted'
        }
        New-Item -ItemType Directory -Force -Path (Join-Path $runRoot 'artifacts') | Out-Null
        Invoke-NativeStep 'Hermes Brain retrieval benchmark' {
            & $python -B $eval `
                --index (Join-Path $brainRoot 'tooling\index') `
                --knowledge (Join-Path $brainRoot 'knowledge') `
                --cases $cases `
                --k 5 `
                --min-recall 0.90 `
                --min-mrr 0.65 `
                --min-negative-pass 1.0 `
                --report (Join-Path $runRoot 'artifacts\rag-benchmark.json')
        }
    } finally {
        Pop-Location
    }

    if (-not $SkipFull) {
        Push-Location $autowinRoot
        try {
            Invoke-NativeStep 'Autowin full test gate' { & npm test }
            Invoke-NativeStep 'Autowin Electron build' { & npm run build }
            Invoke-NativeStep 'Autowin Electron package' { & npx electron-builder --dir }
            Invoke-NativeStep 'Autowin package contents' {
                & powershell -NoProfile -File (Join-Path $PSScriptRoot 'assert-package-content.ps1')
            }
            Invoke-NativeStep 'Autowin package freshness' {
                & powershell -NoProfile -File (Join-Path $PSScriptRoot 'assert-ui-package-fresh.ps1')
            }
        } finally {
            Pop-Location
        }
    }

    if (-not $SkipUi) {
        $uiProof = Join-Path $PSScriptRoot 'cdp-memory-system-proof.mjs'
        if (-not (Test-Path -LiteralPath $uiProof)) { throw 'Memory UI proof is not mounted' }
        Invoke-NativeStep 'Memory Electron proof' { & node $uiProof }
    }
} finally {
    if ($null -eq $oldPythonPath) { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue }
    else { $env:PYTHONPATH = $oldPythonPath }
    if ($null -eq $oldNoByteCode) { Remove-Item Env:PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue }
    else { $env:PYTHONDONTWRITEBYTECODE = $oldNoByteCode }
}
