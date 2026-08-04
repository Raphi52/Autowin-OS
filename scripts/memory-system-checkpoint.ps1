param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Name
)

$ErrorActionPreference = 'Stop'
$autowinRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hermesRoot = 'C:\Users\raphael.vilain\Hermes-Brain'
$runRoot = Join-Path $autowinRoot 'Audit\workspaces\019f884e-ab2c-7932-aaed-e715595a4c11\perfect-memory-system-workspace'
$checkpointRoot = Join-Path $runRoot (Join-Path 'checkpoints' $Name)

if (Test-Path -LiteralPath $checkpointRoot) {
    throw "Checkpoint already exists: $checkpointRoot"
}

$repositories = @(
    [ordered]@{
        label = 'autowin'
        root = $autowinRoot
        files = @(
            'src/main/brain-protocol.ts',
            'src/main/brain-protocol.test.ts',
            'src/main/brain-retrieval.ts',
            'src/main/brain-retrieval.test.ts',
            'src/main/brain-remember.ts',
            'src/main/brain-remember.test.ts',
            'src/main/session-memory-echo.ts',
            'src/main/session-memory-echo.test.ts',
            'src/main/brain-corpus-scope.ts',
            'src/main/brain-corpus-scope.test.ts',
            'src/main/brain-query-command.ts',
            'src/main/brain-query-command.test.ts',
            'src/main/orchestrator.ts',
            'src/main/orchestrator.execution.test.ts',
            'src/main/commands.ts',
            'src/main/commands.test.ts',
            'src/main/index.ts',
            'src/main/amitel-paths.ts',
            'src/main/brain-server-launch.ts',
            'src/main/brain-server-launch.test.ts',
            'src/main/viz/fs-brains.ts',
            'src/main/viz/fs-brains.test.ts',
            'src/main/viz/brain-worker.ts',
            'src/preload/index.ts',
            'src/preload/index.d.ts',
            'src/renderer/src/components/GraphView.tsx',
            'src/renderer/src/components/GraphView.refresh.test.tsx',
            'src/renderer/src/assets/app-shell.css',
            'scripts/verify-memory-system.ps1',
            'scripts/cdp-memory-system-proof.mjs'
        )
    },
    [ordered]@{
        label = 'hermes-brain'
        root = $hermesRoot
        files = @(
            'install.ps1',
            'README.md',
            'tooling/brain_auth.py',
            'tooling/brain_context.py',
            'tooling/brain_index.py',
            'tooling/brain_retrieval.py',
            'tooling/brain_server.py',
            'tooling/brain_eval.py',
            'tooling/eval/rag-golden.json',
            'tooling/tests/test_brain_automation.py',
            'tooling/tests/test_brain_eval.py',
            'tests/test_brain_index.py',
            'tests/test_brain_ingest.py'
        )
    }
)

$manifestRepos = @()
foreach ($repo in $repositories) {
    if (-not (Test-Path -LiteralPath $repo.root -PathType Container)) {
        throw "Repository root unavailable: $($repo.root)"
    }
    $head = (& git -C $repo.root rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $head) { throw "Cannot resolve HEAD for $($repo.root)" }
    $entries = @()
    foreach ($relative in $repo.files) {
        $source = Join-Path $repo.root $relative
        $exists = Test-Path -LiteralPath $source -PathType Leaf
        $entry = [ordered]@{
            path = $relative.Replace('\', '/')
            exists = $exists
            gitStatus = ((& git -C $repo.root status --short -- $relative) -join "`n")
        }
        if ($exists) {
            $item = Get-Item -LiteralPath $source
            $entry.sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
            $entry.size = $item.Length
            $entry.mtimeUtc = $item.LastWriteTimeUtc.ToString('o')
            $destination = Join-Path $checkpointRoot (Join-Path $repo.label $relative)
            New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
            Copy-Item -LiteralPath $source -Destination $destination
        }
        $entries += [pscustomobject]$entry
    }
    $manifestRepos += [pscustomobject]([ordered]@{
        label = $repo.label
        root = $repo.root
        branch = ((& git -C $repo.root branch --show-current).Trim())
        head = $head
        files = $entries
    })
}

New-Item -ItemType Directory -Force -Path $checkpointRoot | Out-Null
$manifest = [ordered]@{
    schema = 'autowin-memory-checkpoint/v1'
    name = $Name
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    repositories = $manifestRepos
}
$manifestPath = Join-Path $checkpointRoot 'manifest.json'
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output $manifestPath

