<#
  LANCER N'IMPORTE QUELLE APPLICATION DANS UN BUREAU WINDOWS CACHE (HDESK), sans toucher a l'ecran
  de l'utilisateur. Complement de scripts/hdesk-observe.ps1 (meme nom de bureau AutowinTest_<id>),
  qui capture ensuite ce bureau.

  Pourquoi (kaizen conv-526, tour c14c2d28-f864-4ca5-ba3f-3dfe24e41d47, 2026-09-13) : l'agent a
  lance RobloxStudioBeta.exe par Bash sur le bureau INTERACTIF puis capture l'ecran reel ; l'utilisateur
  a annule 7 s plus tard. Le bureau cache n'existait que pour Autowin (autowin-headless.ps1).

  Usage : powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id roblox -Executable "C:\...\app.exe" -Travail "ce que je fais" -Conversation conv-526 [-Arguments "a b"] [-AttenteSecondes 30]
  Puis  : powershell -NoProfile -File scripts/hdesk-observe.ps1 -InstanceId roblox -Output capture.png
  Limites connues : pas de clic/clavier dans ce bureau (desktop_act vise l'ecran reel) ; une app
  rendue par GPU peut se capturer noire — la capture le dit (uni = true, exit 2). Une app a
  INSTANCE UNIQUE deja ouverte (ex. Bloc-notes moderne, mesure 2026-09-13) confie le travail a son
  processus existant : le pid lance disparait et rien n'est isole. Verifier que `pid` vit encore.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Id,
  [Parameter(Mandatory = $true)][string]$Executable,
  [string]$Arguments = '',
  [int]$AttenteSecondes = 30,
  # Duree de surveillance APRES la premiere fenetre (crash RigV3 mesure a ~4 s, conv-540).
  [int]$SurvieSecondes = 6,
  # RELIE LE BUREAU A SON TRAVAIL : la petite TV de la conversation affiche ce libelle et filtre
  # sur la conversation. Ecrit dans %LOCALAPPDATA%\autowin-hdesk\<id>.json — hors du depot : un agent lance depuis
  # une copie de travail doit etre vu par l'app (voir src/main/hdesk-tv.ts).
  # OBLIGATOIRES (2026-09-13) : optionnels, ils etaient oublies et la TV montrait des onglets
  # « travail non relie ». Un bureau sans fil n'est plus lancable.
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Travail,
  # Le fil : -Conversation, sinon AUTOWIN_CONVERSATION_ID, posee par Autowin dans l'environnement
  # de tout agent lance par une orchestration (2026-09-14) — l'agent n'a rien a recopier.
  [string]$Conversation = '',
  # Registre des bureaux (fiches <id>.json). Defaut : %LOCALAPPDATA%\autowin-hdesk. Les TESTS passent un dossier
  # temporaire : l'app Autowin en marche purge du registre reel toute fiche sans bureau cache vivant
  # (purgerBureauxFermes, ~0,5 s mesure le 2026-09-23), ce qui effacait la fiche de test avant sa lecture.
  [string]$Registre = ''
)
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
if ([string]::IsNullOrWhiteSpace($Conversation)) { $Conversation = [string]$env:AUTOWIN_CONVERSATION_ID }
if ([string]::IsNullOrWhiteSpace($Conversation)) { throw "Fil absent : passe -Conversation <id> (ou lance depuis un agent Autowin, qui pose AUTOWIN_CONVERSATION_ID)." }
if ($Conversation -notmatch '^[a-zA-Z0-9_-]+$') { throw "Identifiant de fil invalide : '$Conversation'." }
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable introuvable : $Executable" }

# IDENTIFIANT DEJA PRIS = REFUS (conv-617, « mes travaux en parallele se parasitent »). Le bureau
# (AutowinTest_<Id>), le dossier WebView2 et la fiche de la TV sont tous nommes par -Id : deux
# travaux paralleles qui choisissent le meme Id partagent le meme bureau, s'ecrasent la fiche, et
# hdesk-observe capture la fenetre de l'autre. On refuse tant que l'instance precedente VIT.
$registreId = if ([string]::IsNullOrWhiteSpace($Registre)) { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'autowin-hdesk' } else { $Registre }
$ficheId = Join-Path $registreId "$Id.json"
if (Test-Path -LiteralPath $ficheId) {
  try { $fiche = Get-Content -LiteralPath $ficheId -Raw | ConvertFrom-Json } catch { $fiche = $null }
  $vivant = $false
  if ($fiche -and $fiche.pid) { $vivant = [bool](Get-Process -Id ([int]$fiche.pid) -ErrorAction SilentlyContinue) }
  if ($vivant) {
    $libre = "$Id-$Conversation-$PID"
    [pscustomobject]@{
      id = $Id; pret = $false; pidOccupant = [int]$fiche.pid; conversationOccupante = $fiche.conversationId
      travailOccupant = $fiche.travail; idLibre = $libre
      erreur = "Identifiant '$Id' deja utilise par un travail VIVANT (pid $($fiche.pid), fil $($fiche.conversationId)) : meme bureau cache, meme fiche, meme dossier WebView2. Relance avec -Id $libre, ou capture l'instance existante avec hdesk-observe.ps1 -InstanceId $Id."
    } | ConvertTo-Json -Compress
    [Console]::Error.WriteLine("hdesk-lancer : identifiant '$Id' occupe (pid $($fiche.pid)). Utilise -Id $libre.")
    exit 5
  }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AutowinHdeskLanceur {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
    public uint dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateDesktop(string name, IntPtr dev, IntPtr devmode, uint flags, uint access, IntPtr sa);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr hDesk, EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  public const uint STILL_ACTIVE = 259;
  public static int CompterFenetres(IntPtr hDesk) {
    int n = 0;
    EnumDesktopWindows(hDesk, (h, lp) => { if (IsWindowVisible(h)) n++; return true; }, IntPtr.Zero);
    return n;
  }
  public const uint GENERIC_ALL = 0x10000000;
}
'@

$nomBureau = "AutowinTest_$Id"
$hBureau = [AutowinHdeskLanceur]::CreateDesktop($nomBureau, [IntPtr]::Zero, [IntPtr]::Zero, 0, [AutowinHdeskLanceur]::GENERIC_ALL, [IntPtr]::Zero)
if ($hBureau -eq [IntPtr]::Zero) { throw "CreateDesktop('$nomBureau') a echoue (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
$ligne = New-Object System.Text.StringBuilder
[void]$ligne.Append('"').Append($Executable).Append('"')
if ($Arguments) { [void]$ligne.Append(' ').Append($Arguments) }
$si = New-Object AutowinHdeskLanceur+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][AutowinHdeskLanceur+STARTUPINFO])
$si.lpDesktop = $nomBureau
$pi = New-Object AutowinHdeskLanceur+PROCESS_INFORMATION
# DOSSIER WEBVIEW2 PROPRE AU BUREAU, herite par l'app (env = null -> copie du notre). Sans lui, une app
# WebView2 deja ouverte sur l'ecran reel tient le dossier par defaut et l'instance cachee plante au
# demarrage : COMException 0x800700AA « ressource en cours d'utilisation », fenetre noire puis fermeture
# (mesure RigV3Desktop, conv-540, 2026-09-15). Un dossier impose par l'appelant est respecte.
if ([string]::IsNullOrWhiteSpace($env:WEBVIEW2_USER_DATA_FOLDER)) {
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "autowin-hdesk\webview2\$Id"
}
if (-not [AutowinHdeskLanceur]::CreateProcess($Executable, $ligne, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, (Split-Path -Parent $Executable), [ref]$si, [ref]$pi)) {
  [void][AutowinHdeskLanceur]::CloseDesktop($hBureau)
  throw "CreateProcess sur '$nomBureau' a echoue (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
}
[void][AutowinHdeskLanceur]::CloseHandle($pi.hThread)
$lanceA = Get-Date
# Meme regle que autowin-headless.ps1 : NOTRE handle tient le bureau tant que l'app n'y a pas pose
# de fenetre ; le lacher plus tot detruit le bureau sous ses pieds.
$fin = (Get-Date).AddSeconds($AttenteSecondes)
$fenetres = 0
do {
  $fenetres = [AutowinHdeskLanceur]::CompterFenetres($hBureau)
  if ($fenetres -gt 0) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $fin)
[void][AutowinHdeskLanceur]::CloseDesktop($hBureau)
# UNE FENETRE N'EST PAS UN DEMARRAGE REUSSI (kaizen conv-540, tour a3691bd9-88b8-4b86-bd0d-b21c34bae8f2,
# 2026-09-15) : RigV3 a pose sa fenetre puis s'est ferme ~4 s plus tard ; le lanceur avait deja rendu
# pret=true / exit 0 et l'agent ne l'a appris que sur une capture ulterieure. On surveille donc le
# processus $SurvieSecondes apres la fenetre : s'il meurt, exit 4 avec code de sortie et erreurs du
# journal Windows — l'erreur arrive DANS le tour, a l'appel meme, et rien n'est inscrit pour la TV.
$codeSortie = [uint32][AutowinHdeskLanceur]::STILL_ACTIVE
if ($fenetres -gt 0) {
  $finSurvie = (Get-Date).AddSeconds($SurvieSecondes)
  do {
    [void][AutowinHdeskLanceur]::GetExitCodeProcess($pi.hProcess, [ref]$codeSortie)
    if ($codeSortie -ne [AutowinHdeskLanceur]::STILL_ACTIVE) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $finSurvie)
}
[void][AutowinHdeskLanceur]::CloseHandle($pi.hProcess)
if ($fenetres -gt 0 -and $codeSortie -ne [AutowinHdeskLanceur]::STILL_ACTIVE) {
  $nomExe = [IO.Path]::GetFileName($Executable)
  $journal = @()
  try {
    $journal = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2; StartTime = $lanceA.AddSeconds(-2) } -MaxEvents 30 -ErrorAction Stop |
      Where-Object { $_.Message -like "*$nomExe*" } | Select-Object -First 3 |
      ForEach-Object { "$($_.ProviderName): " + (($_.Message -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -First 6) -join ' | ' })
  } catch { }
  [pscustomobject]@{
    id = $Id; desktop = $nomBureau; pid = $pi.dwProcessId; fenetresVisibles = $fenetres; pret = $false
    erreur = "L'application s'est fermee apres avoir ouvert sa fenetre (code de sortie $codeSortie). Corrige la cause avant de capturer ou de conclure."
    codeSortie = $codeSortie; journalWindows = $journal
  } | ConvertTo-Json -Compress
  [Console]::Error.WriteLine("hdesk-lancer : $nomExe mort apres demarrage (code $codeSortie). " + ($journal -join ' || '))
  exit 4
}
if ($fenetres -gt 0) {
  $registre = $registreId
  New-Item -ItemType Directory -Path $registre -Force | Out-Null
  $entree = [pscustomobject]@{ id = $Id; pid = $pi.dwProcessId; executable = $Executable; travail = $Travail; conversationId = $Conversation; lanceLe = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText((Join-Path $registre "$Id.json"), ($entree | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
}
[pscustomobject]@{ id = $Id; desktop = $nomBureau; pid = $pi.dwProcessId; fenetresVisibles = $fenetres; pret = ($fenetres -gt 0) } | ConvertTo-Json -Compress
if ($fenetres -le 0) { exit 3 }
exit 0
