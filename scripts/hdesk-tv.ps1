<#
  PROCESSUS DE CAPTURE OUVERT pour la « petite TV » du bureau cache dans la conversation.
  Relancer hdesk-observe.ps1 a chaque image paie un demarrage PowerShell + compilation C# ; ici la
  compilation est faite UNE fois et le processus repond a des lignes sur son entree standard :
    list                 -> {"bureaux":["<id>",...]}   (bureaux AutowinTest_<id> vivants)
    shot <id> <png>      -> {"id":..,"width":..,"couleursDistinctes":..,"uni":..} ou {"id":..,"erreur":..}
  Entree fermee (TV fermee, app quittee) -> le processus s'arrete. Lecture seule : rien n'agit sur
  le bureau, et chaque capture passe par un thread neuf (sinon Win32 170, voir hdesk-shot.cs).
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'hdesk-shot.cs'))
[Console]::Out.WriteLine('{"pret":true}'); [Console]::Out.Flush()
while ($true) {
  $ligne = [Console]::In.ReadLine()
  if ($null -eq $ligne) { break }
  $parts = $ligne.Trim() -split '\s+', 3
  try {
    if ($parts[0] -eq 'list') {
      $ids = @([AutowinHdeskShot]::ListDesktops() | Where-Object { $_ -like 'AutowinTest_*' } | ForEach-Object { $_.Substring(12) })
      $sortie = @{ bureaux = $ids } | ConvertTo-Json -Compress
    } elseif ($parts[0] -eq 'shot' -and $parts.Count -eq 3 -and $parts[1] -match '^[a-zA-Z0-9_-]+$') {
      $r = [AutowinHdeskShot]::Capture("AutowinTest_$($parts[1])", $parts[2], $true)
      if ($r.Error) { $sortie = @{ id = $parts[1]; erreur = $r.Error } | ConvertTo-Json -Compress }
      else { $sortie = @{ id = $parts[1]; width = $r.Width; height = $r.Height; couleursDistinctes = $r.Distinct; uni = ($r.Distinct -le 1); output = $parts[2] } | ConvertTo-Json -Compress }
    } else { $sortie = @{ erreur = "Commande inconnue : $ligne" } | ConvertTo-Json -Compress }
  } catch { $sortie = @{ erreur = $_.Exception.Message } | ConvertTo-Json -Compress }
  [Console]::Out.WriteLine($sortie); [Console]::Out.Flush()
}
