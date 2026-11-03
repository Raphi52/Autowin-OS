<#
  BANC LIVE de scripts/hdesk-arbre.ps1 (lire l'arbre) et de scripts/hdesk-act.ps1 -Element (appuyer par nom),
  dans des bureaux caches propres au banc — jamais l'ecran de l'utilisateur.

  Pourquoi (conv-1457, 2026-11-03) : un agent ne visait que des pixels. Mesure du jour : sur une fenetre
  WPF NON agrandie, deux clics postes au centre d'une case l'ont laissee « Off » ; TogglePattern la passe a
  « On ». D'ou l'appui selon la technologie : WPF -> accessibilite, Win32 -> clic au centre.

  Deux cibles :
   - Table des caracteres (Win32) : l'arbre porte le bouton d'identifiant 103 (« Selectionner ») ; l'appui
     par -Element 103 met « ! » dans le champ 104, relu par l'arbre. On n'appuie JAMAIS « Copier » (il
     ecrirait dans le presse-papiers de l'utilisateur) ni « Affichage avance » (reglage HKCU de
     l'utilisateur, compare avant/apres).
   - Une fenetre WPF du banc, non agrandie : bouton au nom VIDE (etiquette dans un panneau), case, bouton
     inactif, deux boutons « Doublon ».
  Entree qui doit faire ECHOUER ce banc si l'appui etait faux : -Dossier vers une copie de hdesk-act.ps1
  qui clique au centre au lieu d'utiliser l'accessibilite en WPF -> case restee « Off » -> code 1.
  Usage : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hdesk-arbre.test.ps1 [-Dossier <dossier des scripts>]
  Code 0 = vert ; 1 = rouge ; 2 = banc impossible a monter.
#>
param([string]$Dossier = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$travail = Join-Path $env:TEMP "hdtest-arbre-$PID"
$registre = Join-Path $travail 'registre'
New-Item -ItemType Directory -Force $registre | Out-Null
$idW32 = "hdtest-arbre-w32-$PID"
$idWpf = "hdtest-arbre-wpf-$PID"
$temoin = Join-Path $travail 'clic.txt'
$pret = Join-Path $travail 'pret.txt'
$app = Join-Path $travail 'app-wpf.ps1'
Set-Content -LiteralPath $app -Encoding UTF8 -Value @'
param([string]$Temoin, [string]$Pret)
Add-Type -AssemblyName PresentationFramework
$w = New-Object System.Windows.Window
$w.Title = 'Banc arbre WPF'; $w.Width = 420; $w.Height = 300; $w.Left = 200; $w.Top = 150
$p = New-Object System.Windows.Controls.StackPanel
$b = New-Object System.Windows.Controls.Button
$sp = New-Object System.Windows.Controls.StackPanel
$tb = New-Object System.Windows.Controls.TextBlock; $tb.Text = 'Valider la saisie'; [void]$sp.Children.Add($tb); $b.Content = $sp
$b.Add_Click({ Set-Content -LiteralPath $Temoin -Value 'clic' })
$c = New-Object System.Windows.Controls.CheckBox; $c.Content = 'Option du banc'
$i = New-Object System.Windows.Controls.Button; $i.Content = 'Bouton inactif'; $i.IsEnabled = $false
$d1 = New-Object System.Windows.Controls.Button; $d1.Content = 'Doublon'
$d2 = New-Object System.Windows.Controls.Button; $d2.Content = 'Doublon'
foreach ($x in @($b, $c, $i, $d1, $d2)) { [void]$p.Children.Add($x) }
$w.Content = $p
$w.Add_ContentRendered({ Set-Content -LiteralPath $Pret -Value 'pret' })
[void]$w.ShowDialog()
'@

$echecs = New-Object System.Collections.Generic.List[string]
function Verifier([bool]$ok, [string]$quoi) {
  if ($ok) { Write-Output "ok    : $quoi" } else { Write-Output "ROUGE : $quoi"; $echecs.Add($quoi) }
}
function Arbre([string]$id) {
  # Un refus du script sort sur stderr : avec 'Stop', PowerShell 5.1 en ferait une exception du banc.
  $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-arbre.ps1') -InstanceId $id 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Output "arbre illisible : $o"; return $null }
  return (($o | Out-String) | ConvertFrom-Json)
}
function Appuyer([string]$id, [string]$element) {
  # Un refus du script sort sur stderr : avec 'Stop', PowerShell 5.1 en ferait une exception du banc.
  $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-act.ps1') -InstanceId $id -Element $element -Registre $registre 2>&1
  return [pscustomobject]@{ code = $LASTEXITCODE; sortie = (($o | ForEach-Object { "$_" }) -join "`n") }
}
function Lancer([string]$id, [string]$exe, [string]$arguments, [string]$quoi) {
  # Windows PowerShell 5.1 jette un argument VIDE passe a un autre processus : -Arguments seulement s'il y en a.
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'hdesk-lancer.ps1'),
    '-Id', $id, '-Executable', $exe, '-Travail', $quoi, '-Conversation', 'banc-hdesk',
    '-AttenteSecondes', '30', '-SurvieSecondes', '1', '-Registre', $registre)
  if ($arguments) { $a += @('-Arguments', $arguments) }
  return (& powershell @a | ConvertFrom-Json)
}

$cle = 'HKCU:\Software\Microsoft\CharMap'
$avance = (Get-ItemProperty -LiteralPath $cle -ErrorAction SilentlyContinue).Advanced
$code = 1
$lancements = @()
try {
  # --- Win32 : Table des caracteres ---------------------------------------------------------------
  $charmap = Join-Path $env:WINDIR 'System32\charmap.exe'
  if (-not (Test-Path $charmap)) { Write-Output 'BANC IMPOSSIBLE : charmap.exe absent'; exit 2 }
  $l = Lancer $idW32 $charmap '' 'banc hdesk-arbre (Win32)'
  if (-not $l.pid) { Write-Output "BANC IMPOSSIBLE : Table des caracteres non lancee ($($l.erreur))"; exit 2 }
  $lancements += [int]$l.pid
  Start-Sleep -Milliseconds 500
  $a = Arbre $idW32
  if ($null -eq $a) { Write-Output 'BANC IMPOSSIBLE : arbre Win32 illisible'; exit 2 }
  Verifier ($a.total -gt 0 -and $a.elements.Count -gt 0) "arbre Win32 lu ($($a.total) elements)"
  $b103 = @($a.elements | Where-Object { $_.id -eq '103' })
  Verifier ($b103.Count -eq 1 -and $b103[0].type -eq 'Button' -and $b103[0].techno -eq 'Win32' -and $b103[0].largeur -gt 0) 'bouton 103 present, Win32, avec rectangle'
  $r = Appuyer $idW32 '103'
  Verifier ($r.code -eq 0 -and $r.sortie -match '"appui":"clic"') "appui Win32 par identifiant = clic au centre ($($r.sortie))"
  $champ = $null
  $limite = (Get-Date).AddSeconds(3)
  do {
    Start-Sleep -Milliseconds 200
    $a2 = Arbre $idW32
    if ($a2) { $champ = @($a2.elements | Where-Object { $_.id -eq '104' }) | Select-Object -First 1 }
  } while ((-not $champ -or $champ.valeur -ne '!') -and (Get-Date) -lt $limite)
  Verifier ($champ -and $champ.valeur -eq '!') "le champ 104 contient '!' apres l'appui (lu : '$($champ.valeur)')"

  # --- WPF : fenetre du banc, non agrandie --------------------------------------------------------
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $l = Lancer $idWpf $ps "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$app`" `"$temoin`" `"$pret`"" 'banc hdesk-arbre (WPF)'
  if (-not $l.pid) { Write-Output "BANC IMPOSSIBLE : fenetre WPF non lancee ($($l.erreur))"; exit 2 }
  $lancements += [int]$l.pid
  $limite = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $pret) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $pret)) { Write-Output 'BANC IMPOSSIBLE : fenetre WPF jamais rendue'; exit 2 }
  Start-Sleep -Milliseconds 500
  $w = Arbre $idWpf
  if ($null -eq $w) { Write-Output 'BANC IMPOSSIBLE : arbre WPF illisible'; exit 2 }
  $valider = @($w.elements | Where-Object { $_.type -eq 'Button' -and $_.libelle -eq 'Valider la saisie' })
  Verifier ($valider.Count -eq 1 -and -not $valider[0].nom -and $valider[0].techno -eq 'WPF') 'bouton WPF au nom vide, libelle tire de son etiquette'
  $r = Appuyer $idWpf 'Valider la saisie'
  $limite = (Get-Date).AddSeconds(3)
  while (-not (Test-Path $temoin) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 100 }
  Verifier ($r.code -eq 0 -and $r.sortie -match 'accessibilite:Invoke' -and (Test-Path $temoin)) "appui par libelle -> bouton declenche ($($r.sortie))"
  $r = Appuyer $idWpf 'Option du banc'
  Start-Sleep -Milliseconds 300
  $w2 = Arbre $idWpf
  $case = @($w2.elements | Where-Object { $_.type -eq 'CheckBox' }) | Select-Object -First 1
  Verifier ($r.code -eq 0 -and $case.coche -eq 'On') "appui sur la case -> cochee, relu par l'arbre (lu : '$($case.coche)')"
  $r = Appuyer $idWpf 'Bouton inactif'
  Verifier ($r.code -eq 1 -and $r.sortie -match 'inactif') "bouton inactif refuse ($($r.sortie))"
  $r = Appuyer $idWpf 'Doublon'
  $lignes = @(([regex]::Matches($r.sortie, "Button 'Doublon'")).Count)
  Verifier ($r.code -eq 1 -and $r.sortie -match 'Plusieurs elements' -and $lignes[0] -eq 2) "deux 'Doublon' -> refus qui liste les deux boutons ($($r.sortie))"
  $r = Appuyer $idWpf 'Valider tout'
  Verifier ($r.code -eq 1 -and $r.sortie -match "Valider la saisie") "nom inconnu -> refus qui cite le plus proche ($($r.sortie))"
} finally {
  foreach ($p in $lancements) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $travail -ErrorAction SilentlyContinue
}
$apres = (Get-ItemProperty -LiteralPath $cle -ErrorAction SilentlyContinue).Advanced
Verifier ("$avance" -eq "$apres") "reglage de l'utilisateur CharMap\Advanced inchange ($avance -> $apres)"
if ($echecs.Count -eq 0) { Write-Output 'VERT : arbre lu et appui par nom en Win32 et en WPF'; $code = 0 }
else { Write-Output "ROUGE : $($echecs.Count) verification(s) en echec" }
exit $code
