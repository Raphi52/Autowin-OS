$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("autowin-asar-test-" + [guid]::NewGuid())
$contentRoot = Join-Path $fixtureRoot 'content'
$asarPath = Join-Path $fixtureRoot 'fixture.asar'

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $contentRoot '.autowin-data') | Out-Null
  Set-Content -LiteralPath (Join-Path $contentRoot 'index.js') -Value 'module.exports = true' -Encoding utf8
  Set-Content -LiteralPath (Join-Path $contentRoot '.autowin-data\secret.json') -Value '{}' -Encoding utf8
  Push-Location $projectRoot
  try {
    & npx asar pack $contentRoot $asarPath
    if ($LASTEXITCODE -ne 0) { throw 'Impossible de construire le fixture app.asar.' }
  } finally {
    Pop-Location
  }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell -NoProfile -File (Join-Path $PSScriptRoot 'assert-package-content.ps1') `
    -Root $fixtureRoot -Package 'fixture.asar' 2>&1
  $gateExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($gateExitCode -eq 0) { throw "Le gate a accepté un package contaminé: $output" }
  if ("$output" -notmatch 'runtime interdites') {
    throw "Le gate a échoué pour une raison inattendue: $output"
  }
  Write-Host 'PASS: un app.asar contenant .autowin-data est refusé.'

  Remove-Item -LiteralPath (Join-Path $contentRoot '.autowin-data') -Recurse -Force
  $mainRoot = Join-Path $contentRoot 'out\main'
  New-Item -ItemType Directory -Force -Path $mainRoot | Out-Null
  Set-Content -LiteralPath (Join-Path $mainRoot 'brain-worker.js') -Value 'module.exports = true' -Encoding utf8
  Set-Content -LiteralPath (Join-Path $mainRoot 'worktree-operation-worker.js') -Value 'module.exports = true' -Encoding utf8
  Remove-Item -LiteralPath $asarPath -Force
  Push-Location $projectRoot
  try {
    & npx asar pack $contentRoot $asarPath
    if ($LASTEXITCODE -ne 0) { throw 'Impossible de reconstruire le fixture propre.' }
  } finally {
    Pop-Location
  }
  & powershell -NoProfile -File (Join-Path $PSScriptRoot 'assert-package-content.ps1') `
    -Root $fixtureRoot -Package 'fixture.asar' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Le gate a refusé un package propre avec ses workers.' }
  Write-Host 'PASS: les deux workers runtime sont exigés et acceptés.'

  Remove-Item -LiteralPath (Join-Path $mainRoot 'worktree-operation-worker.js') -Force
  Remove-Item -LiteralPath $asarPath -Force
  Push-Location $projectRoot
  try {
    & npx asar pack $contentRoot $asarPath
    if ($LASTEXITCODE -ne 0) { throw 'Impossible de reconstruire le fixture incomplet.' }
  } finally {
    Pop-Location
  }
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $missingOutput = & powershell -NoProfile -File (Join-Path $PSScriptRoot 'assert-package-content.ps1') `
    -Root $fixtureRoot -Package 'fixture.asar' 2>&1
  $missingExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($missingExitCode -eq 0 -or "$missingOutput" -notmatch 'Workers runtime absents') {
    throw "Le gate n'a pas refusé le worker absent: $missingOutput"
  }
  Write-Host 'PASS: un worker runtime absent est refusé.'
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
