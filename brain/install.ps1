[CmdletBinding()]
param(
    [string]$BrainRoot = "",
    [string]$HermesHome = $(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA "hermes" }),
    [string]$StateRoot = "",
    [string]$RuntimePython = "",
    [switch]$SkipDependencies,
    [switch]$SkipIndex,
    [switch]$SkipUserEnvironment
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot "integrations\windows\hook-command.ps1")
. (Join-Path $PSScriptRoot "integrations\windows\identite.ps1")
# Profil d'entreprise (entreprise/<nom>/identite.json, a la racine du depot) : il garde les noms deja
# poses sur les postes. Absent (version publique) : noms neutres.
$identite = Get-BrainIdentite (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($StateRoot)) { $StateRoot = Join-Path $env:LOCALAPPDATA $identite.dossierLocal }
$nomRacine = Get-BrainNomVariable $identite "AUTOWIN_BRAIN_ROOT"
$nomCode = Get-BrainNomVariable $identite "AUTOWIN_BRAIN_CODE_ROOT"
$nomPython = Get-BrainNomVariable $identite "AUTOWIN_BRAIN_PYTHON"
$nomGreffon = "hermes-$($identite.service)"
if ([string]::IsNullOrWhiteSpace($BrainRoot)) { $BrainRoot = $PSScriptRoot }
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).ProviderPath -replace '\\', '/'
$resolvedBrain = (Resolve-Path -LiteralPath $BrainRoot).ProviderPath -replace '\\', '/'
$knowledge = "$resolvedBrain/knowledge"
if (-not (Test-Path -LiteralPath $knowledge)) { throw "knowledge/ introuvable sous $resolvedBrain" }

$venvRoot = Join-Path $StateRoot ".venv"
$runtimeRoot = Join-Path $StateRoot "tooling"
$python = if ($RuntimePython) { (Resolve-Path -LiteralPath $RuntimePython).ProviderPath } else { Join-Path $venvRoot "Scripts\python.exe" }
$configPath = Join-Path $StateRoot "config.json"
$installedWrapper = Join-Path $StateRoot "$($identite.service)-hook.ps1"
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null

if (-not $SkipDependencies) {
    if (-not (Test-Path -LiteralPath $python)) {
        $uv = Get-Command uv -ErrorAction SilentlyContinue
        if ($uv) {
            & $uv.Source venv --python 3.11 $venvRoot
            if ($LASTEXITCODE -ne 0) { throw "Échec de création du venv avec uv" }
        } else {
            $py = Get-Command py -ErrorAction SilentlyContinue
            if ($py) {
                & $py.Source -3.11 -m venv $venvRoot
                if ($LASTEXITCODE -ne 0) { throw "Échec de création du venv avec py" }
            } else {
                $systemPython = Get-Command python -ErrorAction SilentlyContinue
                if (-not $systemPython) { throw "Installez uv ou Python 3.11, puis relancez install.ps1" }
                & $systemPython.Source -m venv $venvRoot
                if ($LASTEXITCODE -ne 0) { throw "Échec de création du venv avec python" }
            }
        }
    }
    if (-not (Test-Path -LiteralPath $python)) { throw "Le venv local n'a pas été créé: $python" }
    $requirements = "$repoRoot/tooling/requirements.txt"
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        & $uv.Source pip install --python $python -r $requirements
        if ($LASTEXITCODE -ne 0) { throw "Échec d'installation des dépendances avec uv" }
    } else {
        & $python -m pip install -r $requirements
        if ($LASTEXITCODE -ne 0) { throw "Échec d'installation des dépendances avec pip" }
    }
}
if (-not (Test-Path -LiteralPath $python)) { throw "Runtime absent: $python" }

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
# TOUS les modules Python du tooling sont copies, pas une liste nommee a la main. Cette liste
# etait figee a 7 fichiers alors que le serveur en importe desormais une vingtaine
# (brain_trace, brain_singleton, brain_curate, brain_validate, brain_attention...) : une
# reinstallation produisait un serveur qui plantait a l import, ou pire, ecrasait une copie
# saine par une copie amputee. Constate le 2026-09-02.
$runtimeFiles = @(Get-ChildItem -LiteralPath "$repoRoot/tooling" -Filter "*.py" -File | ForEach-Object { $_.Name })
if ($runtimeFiles.Count -lt 1) { throw "aucun module Python trouve dans $repoRoot/tooling" }
# brain_server.py reste verifie NOMMEMENT : son absence doit echouer fort, pas silencieusement.
if ($runtimeFiles -notcontains "brain_server.py") { throw "brain_server.py introuvable dans le clone local" }
foreach ($runtimeFile in $runtimeFiles) {
    $source = "$repoRoot/tooling/$runtimeFile"
    Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeRoot $runtimeFile) -Force
}
# Outils PROPRES a l'entreprise (conv-916) : `entreprise/<nom>/brain/tooling/*.py`, absents de la
# version publique. Le profil les nomme (`metier.couverture`) et le tooling generique les importe a
# cote de lui : sans cette copie, la validation du Brain de l'entreprise signalerait un module absent.
$dossierEntreprise = Join-Path (Split-Path -Parent $repoRoot) 'entreprise'
if (Test-Path -LiteralPath $dossierEntreprise) {
    foreach ($outils in @(Get-ChildItem -LiteralPath $dossierEntreprise -Directory | ForEach-Object { Join-Path $_.FullName 'brain\tooling' })) {
        if (-not (Test-Path -LiteralPath $outils)) { continue }
        foreach ($module in @(Get-ChildItem -LiteralPath $outils -Filter "*.py" -File)) {
            Copy-Item -LiteralPath $module.FullName -Destination (Join-Path $runtimeRoot $module.Name) -Force
        }
    }
}
$indexScript = Join-Path $runtimeRoot "brain_index.py"
Copy-Item -LiteralPath "$repoRoot/integrations/windows/brain-hook.ps1" -Destination $installedWrapper -Force
# Le code installe lit son identite a cote de lui (tooling/brain_identite.py) : il ne voit pas le depot.
if ($identite.brut) {
    [IO.File]::WriteAllText((Join-Path $StateRoot "identite.json"), $identite.brut, $utf8NoBom)
}
$config = [ordered]@{
    brain_root = $resolvedBrain
    code_root = ($runtimeRoot -replace '\\', '/')
    python = ($python -replace '\\', '/')
    installed_from = $repoRoot
    installed_at = [DateTime]::UtcNow.ToString("o")
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), $utf8NoBom)
if (-not $SkipUserEnvironment) {
    [Environment]::SetEnvironmentVariable($nomRacine, $resolvedBrain, "User")
    [Environment]::SetEnvironmentVariable($nomCode, ($runtimeRoot -replace '\\', '/'), "User")
    [Environment]::SetEnvironmentVariable($nomPython, ($python -replace '\\', '/'), "User")
}
Set-Item -Path "Env:$nomRacine" -Value $resolvedBrain
Set-Item -Path "Env:$nomCode" -Value ($runtimeRoot -replace '\\', '/')
Set-Item -Path "Env:$nomPython" -Value ($python -replace '\\', '/')

function Read-JsonObject([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($raw)) { return ($raw | ConvertFrom-Json) }
    }
    return (New-Object PSObject)
}

function Ensure-Property($Object, [string]$Name, $Value) {
    if ($null -eq $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Write-JsonWithBackup([string]$Path, $Object) {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path -LiteralPath $Path) {
        $stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmssfff")
        Copy-Item -LiteralPath $Path -Destination "$Path.$($identite.service).$stamp.bak" -Force
    }
    [IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 30), $utf8NoBom)
}

function Add-UserPromptHook([string]$Path, [string]$Command, [string]$Wrapper) {
    $settings = Read-JsonObject $Path
    Ensure-Property $settings "hooks" (New-Object PSObject)
    Ensure-Property $settings.hooks "UserPromptSubmit" @()
    $present = $false
    foreach ($group in @($settings.hooks.UserPromptSubmit)) {
        foreach ($hook in @($group.hooks)) {
            if (Test-BrainHookCommand ([string]$hook.command) $Wrapper) { $present = $true }
        }
    }
    if (-not $present) {
        $entry = [pscustomobject]@{
            matcher = ""
            hooks = @([pscustomobject]@{ type = "command"; command = $Command; timeout = 15 })
        }
        $settings.hooks.UserPromptSubmit = @($settings.hooks.UserPromptSubmit) + @($entry)
        Write-JsonWithBackup $Path $settings
    }
}

$hookCommands = Get-BrainHookCommands $installedWrapper
$command = $hookCommands.Quoted
Add-UserPromptHook (Join-Path $env:USERPROFILE ".claude\settings.json") $command $installedWrapper
$codexHome = Join-Path $env:USERPROFILE ".codex"
Add-UserPromptHook (Join-Path $codexHome "hooks.json") $command $installedWrapper

$codexTrusted = $false
$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
if ($codexCommand) {
    $codexTrustOutput = (& $python "$repoRoot/tooling/codex_trust_hook.py" --codex $codexCommand.Source --codex-home $codexHome --cwd $repoRoot --wrapper $installedWrapper 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "Le hook Codex a été installé mais son approbation ciblée a échoué: $codexTrustOutput" }
    $codexTrusted = $true
} else {
    Write-Warning "Codex CLI absent: hook copié mais non approuvé. Relancez install.ps1 après installation de Codex."
}

$pluginSource = "$repoRoot/integrations/hermes-brain"
$pluginTarget = Join-Path $HermesHome "plugins\$nomGreffon"
New-Item -ItemType Directory -Force -Path $pluginTarget | Out-Null
Copy-Item -Path "$pluginSource\*" -Destination $pluginTarget -Recurse -Force
# Le greffon porte le nom du service : celui deja active dans Hermes sur les postes de l'entreprise.
$pluginManifest = Join-Path $pluginTarget "plugin.yaml"
$manifestText = [IO.File]::ReadAllText($pluginManifest) -replace '(?m)^name:.*$', "name: $nomGreffon"
[IO.File]::WriteAllText($pluginManifest, $manifestText, $utf8NoBom)
if ($identite.brut) {
    [IO.File]::WriteAllText((Join-Path $pluginTarget "identite.json"), $identite.brut, $utf8NoBom)
}

$hermesEnabled = $false
$hermesCommand = Get-Command hermes -ErrorAction SilentlyContinue
if ($hermesCommand) {
    $oldHermesHome = $env:HERMES_HOME
    $env:HERMES_HOME = $HermesHome
    try {
        $pluginList = (& $hermesCommand.Source plugins list --plain --no-bundled 2>&1 | Out-String)
        $alreadyEnabled = $LASTEXITCODE -eq 0 -and $pluginList -match ('(?m)^enabled\s+\S+\s+\S+\s+' + [regex]::Escape($nomGreffon) + '\s*$')
        if (-not $alreadyEnabled) {
            $enableOutput = ("n" | & $hermesCommand.Source plugins enable $nomGreffon 2>&1 | Out-String)
            if ($LASTEXITCODE -ne 0) { throw "Le plugin Hermes a été copié mais son activation a échoué: $enableOutput" }
        }
        $hermesEnabled = $true
    } finally {
        if ($null -eq $oldHermesHome) {
            Remove-Item Env:HERMES_HOME -ErrorAction SilentlyContinue
        } else {
            $env:HERMES_HOME = $oldHermesHome
        }
    }
} else {
    Write-Warning "Hermes CLI absent: plugin copié mais non activé. Lancez 'hermes plugins enable $nomGreffon' après installation de Hermes."
}

if (-not $SkipIndex) {
    $oldPythonPath = $env:PYTHONPATH
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    try {
        & $python $indexScript --knowledge $knowledge --out "$resolvedBrain/tooling/index"
        if ($LASTEXITCODE -ne 0) { throw "Échec de l'indexation" }
    } finally {
        if ($null -ne $oldPythonPath) { $env:PYTHONPATH = $oldPythonPath }
    }
}

$result = [ordered]@{
    brain_root = $resolvedBrain
    code_root = ($runtimeRoot -replace '\\', '/')
    python = ($python -replace '\\', '/')
    claude_hook = (Join-Path $env:USERPROFILE ".claude\settings.json")
    codex_hook = (Join-Path $env:USERPROFILE ".codex\hooks.json")
    codex_trusted = $codexTrusted
    hermes_plugin = $pluginTarget
    hermes_enabled = $hermesEnabled
    restart_required = @("Hermes", "Claude Code", "Codex")
}
$result | ConvertTo-Json -Depth 10
