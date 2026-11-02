<#
  BANC LIVE de scripts/hdesk-act.ps1 sur une fenetre WPF : un clic poste doit DECLENCHER un bouton WPF.

  Pourquoi (conv-415, 2026-11-02) : dans le bureau cache, RIG (WPF) recevait le clavier mais aucun clic
  n'ouvrait une tuile. Cause : WPF relit l'etat reel du bouton par GetKeyState(VK_LBUTTON)
  (Win32MouseDevice.GetButtonStateFromSystem) ; un WM_LBUTTONDOWN poste ne le change pas, donc WPF voyait
  le bouton relache. Correctif : hdesk-act.cs/Cliquer pose VK_LBUTTON dans la file d'entree de la cible
  (AttachThreadInput + SetKeyboardState) le temps du DOWN.

  Cible : une fenetre WPF maximisee (PowerShell + PresentationFramework) faite d'un seul bouton ; son
  evenement Click ecrit un fichier temoin. Clic en (400,300) -> le fichier doit apparaitre.
  Entree qui doit faire ECHOUER ce banc si le correctif est faux : -Dossier vers une copie de hdesk-act.ps1
  dont hdesk-act.cs poste DOWN/UP sans poser VK_LBUTTON (l'ancien code) -> fichier temoin absent -> code 1.
  Usage : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hdesk-act.wpf.test.ps1 [-Dossier <dossier de hdesk-act.ps1>]
  Code 0 = vert ; 1 = rouge ; 2 = banc impossible a monter.
#>
param([string]$Dossier = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$id = "hdtest-wpf-$PID"
$travail = Join-Path $env:TEMP "hdtest-wpf-$PID"
$registre = Join-Path $travail 'registre'
New-Item -ItemType Directory -Force $registre | Out-Null
$temoin = Join-Path $travail 'clic.txt'
$pret = Join-Path $travail 'pret.txt'
$app = Join-Path $travail 'app-wpf.ps1'
Set-Content -LiteralPath $app -Encoding UTF8 -Value @'
param([string]$Temoin, [string]$Pret)
Add-Type -AssemblyName PresentationFramework
$w = New-Object System.Windows.Window
$w.Title = 'Banc hdesk WPF'; $w.WindowState = 'Maximized'
$b = New-Object System.Windows.Controls.Button
$b.Content = 'Cliquer ici'; $b.FontSize = 40
$b.Add_Click({ Set-Content -LiteralPath $Temoin -Value 'clic' })
$w.Content = $b
$w.Add_ContentRendered({ Set-Content -LiteralPath $Pret -Value 'pret' })
[void]$w.ShowDialog()
'@
$code = 1
$lanc = $null
try {
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $lanc = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'hdesk-lancer.ps1') `
    -Id $id -Executable $ps -Arguments "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$app`" `"$temoin`" `"$pret`"" `
    -Travail 'banc hdesk-act (clic WPF)' -Conversation 'banc-hdesk' -AttenteSecondes 30 -SurvieSecondes 1 -Registre $registre | ConvertFrom-Json
  if (-not $lanc.pid) { Write-Output "BANC IMPOSSIBLE : l'app WPF n'a pas demarre ($($lanc.erreur))"; exit 2 }
  $limite = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $pret) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $pret)) { Write-Output 'BANC IMPOSSIBLE : fenetre WPF jamais rendue'; exit 2 }
  Start-Sleep -Milliseconds 500
  $clic = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-act.ps1') -InstanceId $id -X 400 -Y 300 | ConvertFrom-Json
  $limite = (Get-Date).AddSeconds(3)
  while (-not (Test-Path $temoin) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 100 }
  $porte = Test-Path $temoin
  [pscustomobject]@{ dossier = $Dossier; cible = $clic.cible; messages = $clic.messages; clicPorte = $porte } | ConvertTo-Json -Compress
  if ($porte) { Write-Output 'VERT : le clic poste declenche le bouton WPF'; $code = 0 }
  else { Write-Output 'ROUGE : clic poste sans effet sur le bouton WPF' }
} finally {
  if ($lanc -and $lanc.pid) { Stop-Process -Id ([int]$lanc.pid) -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $travail -ErrorAction SilentlyContinue
}
exit $code
