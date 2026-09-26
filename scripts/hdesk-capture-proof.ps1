<#
  PREUVE RÉELLE — une instance Autowin lancée dans un BUREAU WINDOWS ISOLÉ (HDESK) rend-elle
  encore une capture NON VIDE ? C'est la question qui décide du chantier « bureau isolé » :
  un bureau non affiché n'a aucun compositeur d'écran, donc toute capture qui passe par la
  SURFACE de la fenêtre y échoue. Ce script ne prouve QUE le lancement + l'ouverture de CDP ;
  la capture elle-même est faite par scripts/hdesk-capture-proof.mjs, qui juge l'image.

  Modèle : D:\RigTestViewer\Rig.Wpf.Kbis.SmokeRunner\RigDesktop.cs (CreateDesktop /
  STARTUPINFO.lpDesktop / CloseDesktop).
#>
param(
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId = 'hdeskproof',
  [ValidateRange(1024, 65535)][int]$Port = 9251,
  [switch]$DisableGpu
)
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AutowinHdesk {
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
  // GENERIC_ALL sur l'objet bureau : le process lancé doit pouvoir y créer ses fenêtres.
  public const uint GENERIC_ALL = 0x10000000;
  public const uint STARTF_USESHOWWINDOW = 0x00000001;
  public const short SW_SHOW = 5;
}
'@

$racineDepot = Split-Path -Parent $PSScriptRoot
$executable  = Join-Path $racineDepot 'dist\win-unpacked\autowin-os.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Binaire introuvable : $executable" }

$instanceRoot = Join-Path (Join-Path $racineDepot 'Audit') "hdesk-proof\$InstanceId"
$userData = Join-Path $instanceRoot 'user-data'
New-Item -ItemType Directory -Path $userData -Force | Out-Null

# Même amorçage que scripts/autowin-headless.ps1 : sur un profil VIERGE, la topologie par défaut
# lève et le process meurt AVANT d'ouvrir le port CDP. Sans cette semence, la preuve mesurerait
# un démarrage raté, pas le bureau isolé.
$racineDonnees = Join-Path (Join-Path $userData 'app-data') 'autowin-os'
$cacheModeles = Join-Path $racineDonnees 'model-catalog.json'
if (-not (Test-Path -LiteralPath $cacheModeles)) {
  $semence = Join-Path $PSScriptRoot 'fixtures\model-catalog-seed.json'
  if (-not (Test-Path -LiteralPath $semence -PathType Leaf)) { throw "Semence de catalogue introuvable : $semence" }
  New-Item -ItemType Directory -Path $racineDonnees -Force | Out-Null
  Copy-Item -LiteralPath $semence -Destination $cacheModeles -Force
}

$nomBureau = "AutowinTest_$InstanceId"
$hDesk = [AutowinHdesk]::CreateDesktop($nomBureau, [IntPtr]::Zero, [IntPtr]::Zero, 0, [AutowinHdesk]::GENERIC_ALL, [IntPtr]::Zero)
if ($hDesk -eq [IntPtr]::Zero) { throw "CreateDesktop('$nomBureau') a échoué (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }

$arguments = @("--remote-debugging-port=$Port", "--user-data-dir=$userData", '--isolated-test-instance', '--headless-test-instance')
if ($DisableGpu) { $arguments += '--disable-gpu' }
$cmd = New-Object System.Text.StringBuilder
[void]$cmd.Append('"').Append($executable).Append('"')
foreach ($a in $arguments) { [void]$cmd.Append(' "').Append($a).Append('"') }

$si = New-Object AutowinHdesk+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][AutowinHdesk+STARTUPINFO])
$si.lpDesktop = $nomBureau          # <- LE point : le process naît dans le bureau isolé.
$si.dwFlags = [AutowinHdesk]::STARTF_USESHOWWINDOW
$si.wShowWindow = [AutowinHdesk]::SW_SHOW
$pi = New-Object AutowinHdesk+PROCESS_INFORMATION

$ok = [AutowinHdesk]::CreateProcess($executable, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero,
  (Split-Path -Parent $executable), [ref]$si, [ref]$pi)
if (-not $ok) {
  [void][AutowinHdesk]::CloseDesktop($hDesk)
  throw "CreateProcess sur le bureau '$nomBureau' a échoué (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
}
[void][AutowinHdesk]::CloseHandle($pi.hThread)
[void][AutowinHdesk]::CloseHandle($pi.hProcess)

$deadline = (Get-Date).AddSeconds(45)
$pages = $null
do {
  if ($null -eq (Get-Process -Id $pi.dwProcessId -ErrorAction SilentlyContinue)) {
    [void][AutowinHdesk]::CloseDesktop($hDesk)
    throw "Le process (PID $($pi.dwProcessId)) est mort avant l'ouverture de CDP sur le bureau '$nomBureau'."
  }
  try { $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 1 } catch { $pages = $null }
  if ($pages) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if (-not $pages) {
  Stop-Process -Id $pi.dwProcessId -Force -ErrorAction SilentlyContinue
  [void][AutowinHdesk]::CloseDesktop($hDesk)
  throw "CDP indisponible sur le port $Port après 45 s (bureau '$nomBureau', PID $($pi.dwProcessId))."
}

# Le handle de bureau est relâché ici : l'objet SURVIT tant que le process y vit. Windows le
# détruit tout seul quand plus rien ne l'habite — CloseDesktop ne détruit pas, il lâche.
[void][AutowinHdesk]::CloseDesktop($hDesk)
[pscustomobject]@{
  instanceId = $InstanceId; desktop = $nomBureau; pid = $pi.dwProcessId; port = $Port
  disableGpu = [bool]$DisableGpu; userData = $userData
  webSocketDebuggerUrl = $pages[0].webSocketDebuggerUrl
} | ConvertTo-Json -Compress
exit 0
