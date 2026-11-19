<#
  BANC LIVE de scripts/hdesk-act.ps1 : une frappe -SansClic SANS -X/-Y part dans le champ qui a le focus.

  Pourquoi : le refus de bureau_cache_agir conseillait « appuie sur l'element, puis tape avec
  `sansClic: true` (le curseur reste pose) », mais refusait ensuite toute frappe sans x/y. Mesure du
  19/11/2026 sur les erreurs d'outil notees par l'app : 3 fils sur 3 jours ({sansClic, touche:"Entree"},
  {sansClic, texte:"300", touche:"Tab"}, {sansClic, touche:"Echap"}) refuses par « passe `element`, ou `x` et `y` ».

  Cible : une fenetre WPF maximisee faite d'un seul champ texte ; chaque changement de son texte est
  ecrit dans un fichier temoin. Clic en (400,300) pour poser le focus, puis frappe « abc » + Tab SANS
  point : le temoin doit valoir « abc ».
  Usage : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hdesk-act.sansclic.test.ps1 [-Dossier <dossier de hdesk-act.ps1>]
  Code 0 = vert ; 1 = rouge ; 2 = banc impossible a monter.
#>
param([string]$Dossier = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$id = "hdtest-sansclic-$PID"
$travail = Join-Path $env:TEMP "hdtest-sansclic-$PID"
$registre = Join-Path $travail 'registre'
New-Item -ItemType Directory -Force $registre | Out-Null
$temoin = Join-Path $travail 'texte.txt'
$pret = Join-Path $travail 'pret.txt'
$app = Join-Path $travail 'app-wpf.ps1'
Set-Content -LiteralPath $app -Encoding UTF8 -Value @'
param([string]$Temoin, [string]$Pret)
Add-Type -AssemblyName PresentationFramework
$w = New-Object System.Windows.Window
$w.Title = 'Banc hdesk sans clic'; $w.WindowState = 'Maximized'
$t = New-Object System.Windows.Controls.TextBox
$t.FontSize = 40
$t.Add_TextChanged({ Set-Content -LiteralPath $Temoin -Value $t.Text -NoNewline })
$w.Content = $t
$w.Add_ContentRendered({ Set-Content -LiteralPath $Pret -Value 'pret' })
[void]$w.ShowDialog()
'@
$code = 1
$lanc = $null
$acte = Join-Path $Dossier 'hdesk-act.ps1'
try {
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $lanc = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'hdesk-lancer.ps1') `
    -Id $id -Executable $ps -Arguments "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$app`" `"$temoin`" `"$pret`"" `
    -Travail 'banc hdesk-act (frappe sans clic)' -Conversation 'banc-hdesk' -AttenteSecondes 30 -SurvieSecondes 1 -Registre $registre | ConvertFrom-Json
  if (-not $lanc.pid) { Write-Output "BANC IMPOSSIBLE : l'app WPF n'a pas demarre ($($lanc.erreur))"; exit 2 }
  $limite = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $pret) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $pret)) { Write-Output 'BANC IMPOSSIBLE : fenetre WPF jamais rendue'; exit 2 }
  Start-Sleep -Milliseconds 500
  # Un refus du script sort sur stderr : il doit etre LU comme un rouge, pas arreter le banc.
  $ErrorActionPreference = 'Continue'
  # 1. Le clic pose le focus dans le champ (chemin deja prouve par hdesk-act.wpf.test.ps1).
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $acte -InstanceId $id -X 400 -Y 300 -Registre $registre 2>&1
  # 2. La frappe SANS point : c'est ce que le banc prouve.
  $sortie = & powershell -NoProfile -ExecutionPolicy Bypass -File $acte -InstanceId $id -SansClic -Texte 'abc' -Touche 'Tab' -Registre $registre 2>&1
  $codeFrappe = $LASTEXITCODE
  $limite = (Get-Date).AddSeconds(3)
  $lu = ''
  while ((Get-Date) -lt $limite) {
    if (Test-Path $temoin) { $lu = [IO.File]::ReadAllText($temoin) }
    if ($lu -eq 'abc') { break }
    Start-Sleep -Milliseconds 100
  }
  [pscustomobject]@{ dossier = $Dossier; codeFrappe = $codeFrappe; sortie = (@($sortie) -join ' | '); texte = $lu } | ConvertTo-Json -Compress
  if ($codeFrappe -eq 0 -and $lu -eq 'abc') { Write-Output 'VERT : la frappe sans point atteint le champ qui a le focus'; $code = 0 }
  else { Write-Output "ROUGE : frappe sans point refusee ou perdue (code $codeFrappe, texte '$lu')" }
} finally {
  if ($lanc -and $lanc.pid) { Stop-Process -Id ([int]$lanc.pid) -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $travail -ErrorAction SilentlyContinue
}
exit $code
