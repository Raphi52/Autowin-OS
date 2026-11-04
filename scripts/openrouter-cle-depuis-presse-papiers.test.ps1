# Test du script d'enregistrement de la clé OpenRouter (conv-1471). Refuse de tourner si une vraie
# clé est déjà enregistrée, pour ne jamais l'écraser ; restaure le presse-papiers à la fin.
$ErrorActionPreference = 'Stop'
if ([Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User')) { Write-Output 'SAUTE : une clé existe déjà'; exit 0 }
$script = Join-Path $PSScriptRoot 'openrouter-cle-depuis-presse-papiers.ps1'
$avant = Get-Clipboard -Raw
$echecs = 0
try {
  Set-Clipboard -Value 'pas une cle'
  $sortie = & powershell -NoProfile -File $script; $code = $LASTEXITCODE
  if ($code -ne 2 -or [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User')) { $echecs++; Write-Output "KO refus ($code)" } else { Write-Output 'OK refus sans clé' }
  $faux = 'sk-or-v1-' + ('a' * 40)
  Set-Clipboard -Value $faux
  $sortie = & powershell -NoProfile -File $script; $code = $LASTEXITCODE
  $lu = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User')
  if ($code -ne 0 -or $lu -ne $faux) { $echecs++; Write-Output "KO enregistrement ($code)" } else { Write-Output 'OK enregistrement' }
  if (($sortie -join ' ') -match 'aaaa') { $echecs++; Write-Output 'KO la clé est affichée' } else { Write-Output 'OK clé jamais affichée' }
} finally {
  [Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', $null, 'User')
  if ($avant) { Set-Clipboard -Value $avant }
}
exit $echecs
