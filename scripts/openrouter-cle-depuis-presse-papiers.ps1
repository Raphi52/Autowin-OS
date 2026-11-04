# Enregistre la clé OpenRouter copiée dans le presse-papiers comme variable utilisateur Windows
# OPENROUTER_API_KEY, SANS jamais l'afficher (conv-1471, 2026-11-04 : la clé collée à la main dans
# PowerShell n'arrivait jamais dans les variables du compte). Sortie : uniquement un statut.
# Codes : 0 = enregistrée · 2 = presse-papiers sans clé OpenRouter (rien n'est écrit).
$ErrorActionPreference = 'Stop'
$texte = (Get-Clipboard -Raw)
if ($null -eq $texte) { $texte = '' }
$cle = $texte.Trim()
if ($cle -notmatch '^sk-or-[A-Za-z0-9_-]{20,}$') {
  Write-Output 'AUCUNE_CLE : le presse-papiers ne contient pas une clé OpenRouter (sk-or-...). Rien n''est écrit.'
  exit 2
}
[Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', $cle, 'User')
Write-Output ("ENREGISTREE : OPENROUTER_API_KEY (" + $cle.Length + " caractères, valeur non affichée).")
exit 0
