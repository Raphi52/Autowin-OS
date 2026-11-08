<#
  BANC LIVE de scripts/hdesk-arbre.ps1 (lire l'arbre) et de scripts/hdesk-act.ps1 -Element (appuyer par nom),
  dans des bureaux caches propres au banc — jamais l'ecran de l'utilisateur.

  Pourquoi (conv-1457, 2026-11-03) : un agent ne visait que des pixels. Mesure du jour : sur une fenetre
  WPF NON agrandie, deux clics postes au centre d'une case l'ont laissee « Off » ; TogglePattern la passe a
  « On ». D'ou l'appui selon la technologie : WPF -> accessibilite, Win32 -> clic au centre.
  Depuis le 2026-11-08 (reperes, etat apres geste, remplissage) : un repere « @<lecture>:e<n> » vise
  l'element lu, et il est REFUSE (code PERIME) quand l'element a disparu ou change de nom depuis la
  lecture ; la sortie d'un appui porte `apres` (ce qui a change dans la fenetre) ; -Remplir remplit un
  champ, texte lu sur l'entree standard.

  Trois cibles (la troisieme : une liste WinForms de 100 lignes, dont « Ligne 90 » hors ecran) :
   - Table des caracteres (Win32) : l'arbre porte le bouton d'identifiant 103 (« Selectionner ») ; l'appui
     par -Element 103 met « ! » dans le champ 104, relu par l'arbre. On n'appuie JAMAIS « Copier » (il
     ecrirait dans le presse-papiers de l'utilisateur) ni « Affichage avance » (reglage HKCU de
     l'utilisateur, compare avant/apres).
   - Une fenetre WPF du banc, non agrandie : bouton au nom VIDE (etiquette dans un panneau), case, bouton
     inactif, deux boutons « Doublon », un bouton qui en RETIRE un autre, un bouton qui change de NOM, un
     champ texte.
  Entrees qui doivent faire ECHOUER ce banc (-Dossier vers une copie modifiee des scripts) :
   - hdesk-act.ps1 qui clique au centre au lieu d'utiliser l'accessibilite en WPF -> case restee « Off » ;
   - hdesk-arbre.cs qui accepte un repere sans verifier l'element vivant -> l'appui sur le bouton retire
     ou renomme reussit -> code 1.
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
$w.Title = 'Banc arbre WPF'; $w.Width = 420; $w.Height = 380; $w.Left = 200; $w.Top = 150
$p = New-Object System.Windows.Controls.StackPanel
$b = New-Object System.Windows.Controls.Button
$sp = New-Object System.Windows.Controls.StackPanel
$tb = New-Object System.Windows.Controls.TextBlock; $tb.Text = 'Valider la saisie'; [void]$sp.Children.Add($tb); $b.Content = $sp
$b.Add_Click({ Set-Content -LiteralPath $Temoin -Value 'clic' })
$c = New-Object System.Windows.Controls.CheckBox; $c.Content = 'Option du banc'
$i = New-Object System.Windows.Controls.Button; $i.Content = 'Bouton inactif'; $i.IsEnabled = $false
$d1 = New-Object System.Windows.Controls.Button; $d1.Content = 'Doublon'
$d2 = New-Object System.Windows.Controls.Button; $d2.Content = 'Doublon'
$eph = New-Object System.Windows.Controls.Button; $eph.Content = 'Ephemere'
$ret = New-Object System.Windows.Controls.Button; $ret.Content = 'Retirer'
$ret.Add_Click({ [void]$p.Children.Remove($eph) })
$bas = New-Object System.Windows.Controls.Button; $bas.Content = 'Bascule A'
$bas.Add_Click({ $bas.Content = 'Bascule B' })
$tx = New-Object System.Windows.Controls.TextBox; $tx.Name = 'champ'
foreach ($x in @($b, $c, $i, $d1, $d2, $eph, $ret, $bas, $tx)) { [void]$p.Children.Add($x) }
$w.Content = $p
$w.Add_ContentRendered({ Set-Content -LiteralPath $Pret -Value 'pret' })
[void]$w.ShowDialog()
'@
# Liste WinForms de 100 lignes : « Ligne 90 » est hors ecran a l'ouverture (mesure du 2026-11-08 :
# y=1290 pour une fenetre de 250 px) ; l'appui doit la faire defiler a l'ecran, puis cliquer.
$idListe = "hdtest-arbre-liste-$PID"
$pretListe = Join-Path $travail 'pret-liste.txt'
$appListe = Join-Path $travail 'app-liste.ps1'
Set-Content -LiteralPath $appListe -Encoding UTF8 -Value @'
param([string]$Pret)
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form; $f.Text = 'Banc liste'; $f.StartPosition = 'Manual'
$f.Location = New-Object System.Drawing.Point(100, 100); $f.Size = New-Object System.Drawing.Size(300, 250)
$l = New-Object System.Windows.Forms.ListBox; $l.Dock = 'Fill'
for ($i = 1; $i -le 100; $i++) { [void]$l.Items.Add("Ligne $i") }
$f.Controls.Add($l)
$f.Add_Shown({ Set-Content -LiteralPath $Pret -Value 'pret' })
[void]$f.ShowDialog()
'@

$echecs = New-Object System.Collections.Generic.List[string]
function Verifier([bool]$ok, [string]$quoi) {
  if ($ok) { Write-Output "ok    : $quoi" } else { Write-Output "ROUGE : $quoi"; $echecs.Add($quoi) }
}
function Arbre([string]$id) {
  # Un refus du script sort sur stderr : avec 'Stop', PowerShell 5.1 en ferait une exception du banc.
  $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-arbre.ps1') -InstanceId $id -Registre $registre 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Output "arbre illisible : $o"; return $null }
  return (($o | Out-String) | ConvertFrom-Json)
}
function Appuyer([string]$id, [string]$element) {
  # Un refus du script sort sur stderr : avec 'Stop', PowerShell 5.1 en ferait une exception du banc.
  $ErrorActionPreference = 'Continue'
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-act.ps1') -InstanceId $id -Element $element -Registre $registre 2>&1
  return [pscustomobject]@{ code = $LASTEXITCODE; sortie = (($o | ForEach-Object { "$_" }) -join "`n") }
}
# Encodage du texte envoye dans un tube vers un processus : pose au niveau du SCRIPT (mesure du
# 2026-11-08 : pose dans la fonction, il est ignore et « e accent aigu » arrive en « ? »).
$OutputEncoding = New-Object Text.UTF8Encoding $false
# Et dans l'autre sens : hdesk-act.ps1 ecrit en UTF-8 (comme Node le lit), PowerShell decode la sortie
# d'un processus avec [Console]::OutputEncoding (ibm850 par defaut, mesure) : « e accent aigu » y devenait 2 lettres.
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }
function Remplir([string]$id, [string]$element, [string]$texte) {
  # Le texte passe par l'entree standard, comme depuis l'app : jamais dans la ligne de commande.
  $ErrorActionPreference = 'Continue'
  $o = $texte | & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dossier 'hdesk-act.ps1') -InstanceId $id -Element $element -Remplir -TexteEntree -Registre $registre 2>&1
  return [pscustomobject]@{ code = $LASTEXITCODE; sortie = (($o | ForEach-Object { "$_" }) -join "`n") }
}
function Json([string]$sortie) {
  $l = @($sortie -split "`n" | Where-Object { $_.Trim().StartsWith('{') }) | Select-Object -Last 1
  if (-not $l) { return $null }
  try { return ($l | ConvertFrom-Json) } catch { return $null }
}
function Repere($arbre, [scriptblock]$garde) {
  $e = @($arbre.elements | Where-Object $garde) | Select-Object -First 1
  if ($e) { return [string]$e.ref } else { return '' }
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
  $sansRepere = @($a.elements | Where-Object { "$($_.ref)" -notmatch "^@$([regex]::Escape([string]$a.lecture)):e\d+$" })
  Verifier ($a.lecture -and $sansRepere.Count -eq 0) "lecture '$($a.lecture)' : chaque element porte un repere @lecture:eN ($($sansRepere.Count) sans)"
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
  # Repere du bouton 103, lu dans la DERNIERE lecture : l'appui reussit et dit que le champ 104 a change.
  $ref103 = Repere $a2 { $_.id -eq '103' }
  $r = Appuyer $idW32 $ref103
  $j = Json $r.sortie
  Verifier ($r.code -eq 0 -and $j.appui -eq 'clic' -and $j.element.ref -eq $ref103) "appui Win32 par repere $ref103 ($($r.sortie))"
  Verifier ($j.apres.changement -eq $true -and ((@($j.apres.changements) -join ' | ') -match "valeur '!' -> '!!'")) "apres l'appui : le changement du champ 104 est rapporte ($((@($j.apres.changements)) -join ' | '))"
  $ref104 = Repere $a2 { $_.id -eq '104' }
  # Accents ecrits par leur code : ce fichier sans BOM est lu en ANSI par Windows PowerShell 5.1.
  $accents = 'abc ' + [char]0xE9 + [char]0x20AC
  $r = Remplir $idW32 $ref104 $accents
  $j = Json $r.sortie
  Verifier ($r.code -eq 0 -and $j.appui -eq 'accessibilite:SetValue' -and $j.apres.element.valeur -ceq $accents) "remplissage Win32 du champ 104 par l'entree standard, accents compris (lu apres : '$($j.apres.element.valeur)')"
  $r = Appuyer $idW32 '@e8'
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[INVALIDE\]') "repere sans lecture (@e8) refuse ($($r.sortie))"
  $r = Appuyer $idW32 '@zzzzzz:e1'
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[PERIME\]' -and $r.sortie -match 'Reessai : relis') "repere d'une lecture inconnue refuse avec consigne de relecture ($($r.sortie))"

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
  $refCase = Repere $w { $_.type -eq 'CheckBox' }
  $r = Appuyer $idWpf $refCase
  $j = Json $r.sortie
  Start-Sleep -Milliseconds 300
  $w2 = Arbre $idWpf
  $case = @($w2.elements | Where-Object { $_.type -eq 'CheckBox' }) | Select-Object -First 1
  Verifier ($r.code -eq 0 -and $case.coche -eq 'On') "appui par repere sur la case -> cochee, relu par l'arbre (lu : '$($case.coche)')"
  Verifier ($j.apres.changement -eq $true -and $j.apres.element.coche -eq 'On') "apres l'appui : la case est rapportee cochee ($($r.sortie))"
  $r = Appuyer $idWpf 'Bouton inactif'
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[INACTIF\]') "bouton inactif refuse ($($r.sortie))"
  $r = Appuyer $idWpf 'Doublon'
  $lignes = @(([regex]::Matches($r.sortie, "Button 'Doublon' @")).Count)
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[AMBIGU\]' -and $lignes[0] -eq 2) "deux 'Doublon' -> refus qui liste les deux boutons avec leur repere ($($r.sortie))"
  $r = Appuyer $idWpf 'Valider tout'
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[INTROUVABLE\]' -and $r.sortie -match "Valider la saisie") "nom inconnu -> refus qui cite le plus proche ($($r.sortie))"
  # Element RETIRE apres la lecture : son repere est refuse, rien n'est appuye a sa place.
  $w3 = Arbre $idWpf
  $refEph = Repere $w3 { $_.nom -eq 'Ephemere' }
  $r = Appuyer $idWpf 'Retirer'
  $j = Json $r.sortie
  Verifier ($r.code -eq 0 -and ((@($j.apres.changements) -join ' | ') -match "Ephemere' \(disparu\)")) "apres 'Retirer' : la disparition d'Ephemere est rapportee ($((@($j.apres.changements)) -join ' | '))"
  $r = Appuyer $idWpf $refEph
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[PERIME\]' -and $r.sortie -match "n'est plus a l'ecran") "repere d'un element retire refuse ($($r.sortie))"
  # Element RENOMME apres la lecture : meme element, mais il ne dit plus la meme chose -> refus.
  $w4 = Arbre $idWpf
  $refBas = Repere $w4 { $_.nom -eq 'Bascule A' }
  $r = Appuyer $idWpf $refBas
  $j = Json $r.sortie
  Verifier ($r.code -eq 0 -and $j.apres.element.nom -eq 'Bascule B') "appui par repere sur 'Bascule A' -> renomme, rapporte (lu apres : '$($j.apres.element.nom)')"
  $r = Appuyer $idWpf $refBas
  Verifier ($r.code -eq 1 -and $r.sortie -match '^\[PERIME\]' -and $r.sortie -match 'a change' -and $r.sortie -match 'Bascule B') "meme repere apres renommage refuse ($($r.sortie))"
  # Champ WPF rempli par son identifiant.
  $bonjour = 'Bonjour ' + [char]0xE9
  $r = Remplir $idWpf 'champ' $bonjour
  $j = Json $r.sortie
  Verifier ($r.code -eq 0 -and $j.apres.element.valeur -ceq $bonjour) "remplissage WPF du champ 'champ' (lu apres : '$($j.apres.element.valeur)')"

  # --- WinForms : element hors ecran d'une liste -------------------------------------------------
  $l = Lancer $idListe $ps "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$appListe`" `"$pretListe`"" 'banc hdesk-arbre (liste)'
  if (-not $l.pid) { Write-Output "BANC IMPOSSIBLE : liste WinForms non lancee ($($l.erreur))"; exit 2 }
  $lancements += [int]$l.pid
  $limite = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $pretListe) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 200 }
  Start-Sleep -Milliseconds 500
  $li = Arbre $idListe
  $l90 = @($li.elements | Where-Object { $_.nom -eq 'Ligne 90' }) | Select-Object -First 1
  Verifier ($l90 -and $l90.horsEcran -eq $true) "Ligne 90 hors ecran a l'ouverture (y lu : $($l90.y))"
  $r = Appuyer $idListe $l90.ref
  $j = Json $r.sortie
  Verifier ($r.code -eq 0 -and $j.appui -eq 'clic' -and $j.apres.element.selectionne -eq $true) "appui sur Ligne 90 : defilee a l'ecran, cliquee, rapportee selectionnee ($($r.sortie))"
} finally {
  foreach ($p in $lancements) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $travail -ErrorAction SilentlyContinue
}
$apres = (Get-ItemProperty -LiteralPath $cle -ErrorAction SilentlyContinue).Advanced
Verifier ("$avance" -eq "$apres") "reglage de l'utilisateur CharMap\Advanced inchange ($avance -> $apres)"
if ($echecs.Count -eq 0) { Write-Output 'VERT : arbre lu, reperes verifies, appui et remplissage en Win32, WPF et WinForms'; $code = 0 }
else { Write-Output "ROUGE : $($echecs.Count) verification(s) en echec" }
exit $code
