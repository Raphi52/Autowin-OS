<#
  FERMER L'APPLICATION D'UN BUREAU WINDOWS CACHE (HDESK) — PAR BUREAU, JAMAIS PAR NOM.
  Complement de scripts/hdesk-lancer.ps1 (meme registre %LOCALAPPDATA%\autowin-hdesk\<id>.json).

  Pourquoi (conv-222, 2026-10-11, lot 1 du RUN outils-agent-1-2-4-6-7) : hdesk-lancer refuse une
  relance sur le meme identifiant tant que l'app vit (exit 5), et aucun outil ne la fermait. L'agent
  tuait donc un processus a la main — par PID au mieux, par nom au pire, ce qui emporte aussi la
  meme app ouverte sur l'ecran de l'utilisateur.

  Ce qui est vise : le pid inscrit par le lanceur (s'il est bien CE processus : meme executable, ne
  avant l'inscription — un pid recycle n'est jamais vise), les processus qui ont une fenetre sur
  AutowinTest_<id>, et leurs descendants.
  Ce qui est EPARGNE, toujours : tout processus qui a une fenetre sur le bureau de l'utilisateur
  (« Default » — une app a instance unique qui a passe la main la-bas), les outils Autowin du bureau
  (hdesk-basculer.ps1 porte la fenetre « Revenir a mon bureau » : la tuer laisserait l'utilisateur
  coince sur le bureau cache), les processus systeme, et la chaine qui appelle ce script.

  Geste : WM_CLOSE aux fenetres (fermeture douce), attente -DelaiDouxSecondes, puis arret force PAR
  PID de ce qui reste. La fiche est retiree quand plus rien ne vit : l'identifiant est libre.

  BUREAU SANS FICHE (-SansFiche, conv-1016, 2026-10-17) : les bureaux des captures d'interface
  (ui-capture-<pid>, preuve-<pid>) naissent par scripts/autowin-headless.ps1, qui n'ecrit pas ce
  registre. Mesure du 2026-10-17 : trois bureaux ui-capture-* d'hier survivaient a leur capture,
  tenus par OUTLOOK.EXE et KoffBackend.exe que l'instance de test y avait fait demarrer, et la vue
  « Bureaux caches » refusait de les fermer (« Ce bureau n'a pas de fiche »). -SansFiche n'est passe
  QUE par cette vue, sur le geste de l'utilisateur : il ne vise que les processus qui ont une fenetre
  sur AutowinTest_<id> et leurs descendants, avec les MEMES epargnes. Un bureau qui a une fiche est
  refuse dans ce mode : son fil fait foi, le refus « autre conversation » des agents reste entier.

  Usage : powershell -NoProfile -File scripts/hdesk-fermer.ps1 -Id <id> [-Conversation <fil>] [-DelaiDouxSecondes 5]
          powershell -NoProfile -File scripts/hdesk-fermer.ps1 -Id <id> -SansFiche [-DelaiDouxSecondes 5]
  Sortie : JSON {id, desktop, ferme, dejaFerme, fermesDoucement, forces, survivants, epargnes, ficheRetiree, sansFiche?, erreur?}
  Codes : 0 ferme (ou deja ferme) · 1 entree invalide / echec · 2 aucun bureau a ce nom
          5 bureau d'une AUTRE conversation (rien n'est touche) · 6 des processus survivent
#>
param(
  [string]$Id = '',
  # Le fil : -Conversation, sinon AUTOWIN_CONVERSATION_ID (pose par Autowin pour ses agents).
  [string]$Conversation = '',
  [int]$DelaiDouxSecondes = 5,
  # Registre des bureaux. Defaut : %LOCALAPPDATA%\autowin-hdesk. Les TESTS passent un dossier temporaire.
  [string]$Registre = '',
  # Bureau SANS fiche au registre (voir l'en-tete) : aucun fil n'est exige, ni accepte a la place d'une fiche.
  [switch]$SansFiche
)
$ErrorActionPreference = 'Stop'

function Rendre([hashtable]$champs, [int]$code) {
  [pscustomobject]$champs | ConvertTo-Json -Compress -Depth 5
  if ($champs.erreur) { [Console]::Error.WriteLine("hdesk-fermer : $($champs.erreur)") }
  exit $code
}
trap { Rendre @{ id = $Id; ferme = $false; erreur = $_.Exception.Message } 1 }

# Validation MANUELLE (pas Mandatory/ValidatePattern) : sous -File, un parametre obligatoire absent
# fait attendre une saisie sur l'entree standard au lieu d'echouer net.
if ([string]::IsNullOrWhiteSpace($Id)) { Rendre @{ id = $Id; ferme = $false; erreur = 'Identifiant absent : passe -Id <id du bureau cache>.' } 1 }
if ($Id -notmatch '^[a-zA-Z0-9_-]+$') { Rendre @{ id = $Id; ferme = $false; erreur = "Identifiant invalide : '$Id' (lettres, chiffres, - et _ seulement)." } 1 }
if ($DelaiDouxSecondes -lt 1 -or $DelaiDouxSecondes -gt 30) { Rendre @{ id = $Id; ferme = $false; erreur = "Delai doux hors bornes : $DelaiDouxSecondes (1 a 30 secondes)." } 1 }
if (-not $SansFiche) {
  if ([string]::IsNullOrWhiteSpace($Conversation)) { $Conversation = [string]$env:AUTOWIN_CONVERSATION_ID }
  if ([string]::IsNullOrWhiteSpace($Conversation)) { Rendre @{ id = $Id; ferme = $false; erreur = 'Fil absent : passe -Conversation <id> (ou lance depuis un agent Autowin, qui pose AUTOWIN_CONVERSATION_ID).' } 1 }
}

$dossier = if ([string]::IsNullOrWhiteSpace($Registre)) { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'autowin-hdesk' } else { $Registre }
$fichePath = Join-Path $dossier "$Id.json"
$bureau = "AutowinTest_$Id"
$fiche = $null
if (Test-Path -LiteralPath $fichePath) {
  $fiche = Get-Content -LiteralPath $fichePath -Raw | ConvertFrom-Json
  if ($SansFiche) {
    Rendre @{ id = $Id; desktop = $bureau; ferme = $false; conversationOccupante = [string]$fiche.conversationId
      erreur = "Bureau '$Id' inscrit au registre (fil $($fiche.conversationId)) : il se ferme par son fil, pas sans fiche. Rien n'a ete touche." } 1
  }
} elseif (-not $SansFiche) {
  Rendre @{ id = $Id; desktop = $bureau; ferme = $false; erreur = "Aucun bureau cache a ce nom ('$Id') dans le registre : rien n'a ete ferme." } 2
}
if ($fiche -and [string]$fiche.conversationId -ne $Conversation) {
  Rendre @{ id = $Id; desktop = $bureau; ferme = $false; conversationOccupante = [string]$fiche.conversationId
    erreur = "Bureau '$Id' d'une autre conversation ($($fiche.conversationId)) : on ne ferme que ses propres bureaux. Rien n'a ete touche." } 5
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AutowinHdeskFermeur {
  delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr OpenDesktop(string name, uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool EnumDesktopWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr h);
  const uint DESKTOP_READOBJECTS = 0x0001, DESKTOP_ENUMERATE = 0x0040;
  // Fenetres de premier niveau d'un bureau : [hwnd, pid, visible]. null = bureau inexistant.
  public static List<long[]> Fenetres(string bureau) {
    IntPtr h = OpenDesktop(bureau, 0, false, DESKTOP_READOBJECTS | DESKTOP_ENUMERATE);
    if (h == IntPtr.Zero) return null;
    var res = new List<long[]>();
    EnumWindowsProc cb = (w, l) => { uint pid; GetWindowThreadProcessId(w, out pid); res.Add(new long[] { w.ToInt64(), pid, IsWindowVisible(w) ? 1 : 0 }); return true; };
    try { EnumDesktopWindows(h, cb, IntPtr.Zero); } finally { CloseDesktop(h); }
    GC.KeepAlive(cb);
    return res;
  }
  // WM_CLOSE depuis un thread NEUF attache au bureau cache : un message poste depuis un autre bureau
  // n'arrive pas (mesure 2026-10-11 : fermeture douce sans effet, arret force obligatoire). Meme
  // parade que hdesk-act.cs : SetThreadDesktop echoue sur un thread qui possede deja des fenetres.
  public static int Fermer(string bureau, long[] hwnds) {
    int postes = 0;
    var t = new System.Threading.Thread(() => {
      IntPtr h = OpenDesktop(bureau, 0, false, 0x10000000);
      if (h == IntPtr.Zero) return;
      try {
        if (!SetThreadDesktop(h)) return;
        foreach (long w in hwnds) if (PostMessage(new IntPtr(w), 0x0010, IntPtr.Zero, IntPtr.Zero)) postes++;
      } finally { CloseDesktop(h); }
    });
    t.Start(); t.Join();
    return postes;
  }
}
'@

function PidsAvecFenetre([string]$nom) {
  $f = [AutowinHdeskFermeur]::Fenetres($nom)
  if ($null -eq $f) { return @() }
  return @($f | ForEach-Object { [int]$_[1] } | Sort-Object -Unique)
}
function Vivant([int]$p) { return [bool](Get-Process -Id $p -ErrorAction SilentlyContinue) }

# Sans fiche, seul le bureau Windows atteste que l'identifiant designe quelque chose.
if (-not $fiche -and $null -eq [AutowinHdeskFermeur]::Fenetres($bureau)) {
  Rendre @{ id = $Id; desktop = $bureau; ferme = $false; sansFiche = $true; erreur = "Aucun bureau cache '$bureau' vivant : rien n'a ete ferme." } 2
}

$procs = @{}
foreach ($p in @(Get-CimInstance Win32_Process)) { $procs[[int]$p.ProcessId] = $p }

# --- Ce qui est epargne, quoi qu'il arrive ---
$epargnes = @()
$intouchables = @{}
foreach ($p in (PidsAvecFenetre 'Default')) { $intouchables[$p] = 'fenetre sur ton ecran' }
$systeme = @('csrss', 'dwm', 'winlogon', 'wininit', 'services', 'lsass', 'smss', 'svchost', 'explorer', 'system', 'idle',
  'fontdrvhost', 'sihost', 'ctfmon', 'msmpeng', 'taskhostw', 'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'textinputhost')
foreach ($k in @($procs.Keys)) {
  $p = $procs[$k]
  $nom = ([string]$p.Name) -replace '\.exe$', ''
  if ($systeme -contains $nom.ToLower()) { $intouchables[$k] = 'processus systeme' }
  if ([string]$p.CommandLine -match 'hdesk-(basculer|tv|act|observe|fermer|lancer)\.ps1') { $intouchables[$k] = 'outil Autowin du bureau cache' }
}
$chaine = $PID
while ($chaine -and $procs.ContainsKey([int]$chaine) -and -not $intouchables.ContainsKey([int]$chaine)) {
  $intouchables[[int]$chaine] = 'appelant de ce script'
  $chaine = [int]$procs[[int]$chaine].ParentProcessId
}

# --- Ce qui est vise ---
$graines = @{}
$pidFiche = if ($fiche) { [int]$fiche.pid } else { 0 }
if ($pidFiche -gt 0 -and $procs.ContainsKey($pidFiche)) {
  $p = $procs[$pidFiche]
  $memeExe = (-not $fiche.executable) -or ([string]$p.ExecutablePath -ieq [string]$fiche.executable)
  $avant = $true
  if ($fiche.lanceLe -and $p.CreationDate) { try { $avant = ($p.CreationDate -le ([DateTime]::Parse([string]$fiche.lanceLe)).AddSeconds(5)) } catch { $avant = $true } }
  if ($memeExe -and $avant) { $graines[$pidFiche] = $true }
}
foreach ($p in (PidsAvecFenetre $bureau)) { $graines[$p] = $true }

$cibles = @{}
$file = New-Object System.Collections.Queue
foreach ($g in @($graines.Keys)) { $file.Enqueue([int]$g) }
while ($file.Count -gt 0) {
  $c = [int]$file.Dequeue()
  if ($cibles.ContainsKey($c)) { continue }
  if ($intouchables.ContainsKey($c)) {
    if (-not ($epargnes | Where-Object { $_.pid -eq $c })) { $epargnes += [pscustomobject]@{ pid = $c; motif = $intouchables[$c] } }
    continue
  }
  $cibles[$c] = $true
  $parent = $procs[$c]
  foreach ($k in @($procs.Keys)) {
    $enfant = $procs[$k]
    # Un pid parent RECYCLE n'est pas une filiation : l'enfant doit etre ne apres le parent.
    if ([int]$enfant.ParentProcessId -eq $c -and $parent -and $enfant.CreationDate -ge $parent.CreationDate) { $file.Enqueue([int]$k) }
  }
}

$vivants = @($cibles.Keys | Where-Object { Vivant $_ })
if ($vivants.Count -eq 0) {
  if ($fiche) { Remove-Item -LiteralPath $fichePath -Force -ErrorAction SilentlyContinue }
  Rendre @{ id = $Id; desktop = $bureau; ferme = $true; dejaFerme = $true; fermesDoucement = @(); forces = @(); survivants = @()
    epargnes = @($epargnes); ficheRetiree = [bool]$fiche -and -not (Test-Path -LiteralPath $fichePath); sansFiche = -not $fiche } 0
}

# --- 1. Fermeture douce : WM_CLOSE aux fenetres visibles des cibles, sur CE bureau seulement ---
$fenetres = [AutowinHdeskFermeur]::Fenetres($bureau)
if ($null -ne $fenetres) {
  $aFermer = [long[]]@($fenetres | Where-Object { $cibles.ContainsKey([int]$_[1]) -and $_[2] -eq 1 } | ForEach-Object { [long]$_[0] })
  if ($aFermer.Count -gt 0) { [void][AutowinHdeskFermeur]::Fermer($bureau, $aFermer) }
}
$limite = (Get-Date).AddSeconds($DelaiDouxSecondes)
while ((Get-Date) -lt $limite -and @($vivants | Where-Object { Vivant $_ }).Count -gt 0) { Start-Sleep -Milliseconds 250 }
$fermesDoucement = @($vivants | Where-Object { -not (Vivant $_) })

# --- 2. Arret force PAR PID de ce qui reste (et de ce qui serait apparu sur le bureau entre-temps) ---
foreach ($p in (PidsAvecFenetre $bureau)) { if (-not $intouchables.ContainsKey($p)) { $cibles[$p] = $true } }
$forces = @()
foreach ($p in @($cibles.Keys | Where-Object { Vivant $_ })) {
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
  $forces += [int]$p
}
$limite = (Get-Date).AddSeconds(3)
while ((Get-Date) -lt $limite -and @($forces | Where-Object { Vivant $_ }).Count -gt 0) { Start-Sleep -Milliseconds 200 }
$survivants = @($cibles.Keys | Where-Object { Vivant $_ } | ForEach-Object { [int]$_ })

$ficheRetiree = $false
if ($fiche -and $survivants.Count -eq 0) {
  Remove-Item -LiteralPath $fichePath -Force -ErrorAction SilentlyContinue
  $ficheRetiree = -not (Test-Path -LiteralPath $fichePath)
}
$champs = @{ id = $Id; desktop = $bureau; ferme = ($survivants.Count -eq 0); dejaFerme = $false
  fermesDoucement = @($fermesDoucement | ForEach-Object { [int]$_ }); forces = @($forces); survivants = @($survivants)
  epargnes = @($epargnes); ficheRetiree = $ficheRetiree; sansFiche = -not $fiche }
if ($survivants.Count -gt 0) { $champs.erreur = "Processus encore vivants apres l'arret force : $($survivants -join ', ')." }
Rendre $champs $(if ($survivants.Count -eq 0) { 0 } else { 6 })
