param(
  [Parameter(Mandatory = $true)][string]$ProofRoot,
  [Parameter(Mandatory = $true)][string]$RunId,
  [datetime]$StartedAt = (Get-Date).AddHours(-2)
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ProofRoot).Path

foreach ($width in @(340, 420)) {
  $jsonPath = Join-Path $resolvedRoot "a2-hub-$width.json"
  $pngPath = Join-Path $resolvedRoot "a2-hub-$width.png"
  if (-not (Test-Path -LiteralPath $jsonPath -PathType Leaf)) {
    throw "Preuve JSON manquante : $jsonPath"
  }
  if (-not (Test-Path -LiteralPath $pngPath -PathType Leaf)) {
    throw "Capture manquante : $pngPath"
  }
  $proof = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
  if ($proof.runId -ne $RunId) { throw "RunId inattendu dans $jsonPath" }
  if ([int]$proof.width -ne $width) { throw "Largeur inattendue dans $jsonPath" }
  if ([math]::Abs([double]$proof.paneWidth - $width) -gt 1) {
    throw "Le panneau ne mesure pas $width px."
  }
  if ([double]$proof.overflow -gt 1) { throw "Overflow horizontal détecté à $width px." }
  foreach ($state in @('working', 'ready', 'conflict', 'merged')) {
    if ($proof.states -notcontains $state) { throw "État $state absent de la preuve $width px." }
  }
  if (-not $proof.recovered) { throw "État récupéré absent de la preuve $width px." }
  if ($proof.publishedResidue -notmatch 'déjà dans ton workspace') {
    throw "L'état publié avec nouveauté protégée est absent de la preuve $width px."
  }
  if ((Get-Item -LiteralPath $jsonPath).LastWriteTime -lt $StartedAt) {
    throw "Preuve JSON périmée : $jsonPath"
  }
  if ((Get-Item -LiteralPath $pngPath).Length -le 1024) {
    throw "Capture vide ou tronquée : $pngPath"
  }
}

Write-Output "A2_HUB_PROOF_OK $RunId"
