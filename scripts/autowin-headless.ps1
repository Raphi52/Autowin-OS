param(
  [ValidateSet('Start', 'Status', 'Stop')][string]$Action = 'Start',
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [ValidateRange(1024, 65535)][int]$Port = 9240,
  [string]$Executable = '',
  [string]$InstancesRoot = ''
)

$ErrorActionPreference = 'Stop'
<#
  UN ECHEC DOIT SE VOIR DANS LE CODE DE SORTIE.
  Mesure le 2026-09-06 : `powershell -File` rend 0 meme quand le script se termine sur un `throw`
  non attrape. Le succes faisait bien `exit 0`, mais un port deja occupe, un binaire absent ou un
  CDP indisponible rendaient EUX AUSSI 0 — un appelant automatique (scripts/verifier-chemin-critique.mjs)
  prenait donc l'echec pour un demarrage reussi, puis la sonde echouait plus loin sur une cause
  incomprehensible. Ce piege rend l'erreur VISIBLE : message sur stderr, sortie non nulle.
#>
trap {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
<#
  BUREAU WINDOWS ISOLE (HDESK). L'instance de test naissait sur le bureau interactif de
  l'utilisateur, seulement CACHEE : un show(), une boite de dialogue systeme ou un vol de focus
  restaient visibles, et il n'y avait aucun bureau a nettoyer. Elle nait desormais dans un objet
  bureau nomme d'apres l'InstanceId, invisible et non interactif. Modele :
  D:\RigTestViewer\Rig.Wpf.Kbis.SmokeRunner\RigDesktop.cs.

  Mesure du 2026-09-12 (scripts/hdesk-capture-proof.ps1 + .mjs, preuves dans Audit/hdesk-proof) :
  - la capture CDP RESTE VALIDE dans ce bureau non affiche, y compris `fromSurface: true`
    (401 Ko, 256 valeurs distinctes) : aucun script cdp-*.mjs n'a besoin de changer ;
  - le bureau DISPARAIT tout seul quand plus aucun handle ni process ne l'habite : le nettoyage
    est donc porte par l'arret des process, pas par un geste separe. Un bureau peut survivre a un
    process tue brutalement ; le nom, stable et derive de l'InstanceId, est alors REOUVERT par
    CreateDesktop au lieu d'echouer — verifie en reutilisation reelle.
#>
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
  public const uint GENERIC_ALL = 0x10000000;
  public const uint STARTF_USESHOWWINDOW = 0x00000001;
  public const short SW_SHOW = 5;
}
'@

# $PSScriptRoot n'est PAS encore lie quand PowerShell evalue les valeurs par defaut d'un bloc param
# contenant un parametre Mandatory : la racine se resout donc APRES le bloc, jamais dedans.
$racineDepot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Executable)) { $Executable = Join-Path (Join-Path (Join-Path $racineDepot 'dist') 'win-unpacked') 'autowin-os.exe' }
if ([string]::IsNullOrWhiteSpace($InstancesRoot)) { $InstancesRoot = Join-Path (Join-Path $racineDepot 'Audit') 'headless-instances' }
$instanceRoot = Join-Path $InstancesRoot $InstanceId
$userData = Join-Path $instanceRoot 'user-data'
$appData = Join-Path $instanceRoot 'appdata'
$stateFile = Join-Path $instanceRoot 'instance.json'
$nomBureau = "AutowinTest_$InstanceId"

function Read-ExecutableIdentity {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    return [pscustomobject]@{
      executable = $Executable
      executableSha256 = $null
      executableVersion = $null
    }
  }
  $item = Get-Item -LiteralPath $Executable
  $version = $item.VersionInfo.ProductVersion
  if ([string]::IsNullOrWhiteSpace($version)) { $version = $item.VersionInfo.FileVersion }
  return [pscustomobject]@{
    executable = $item.FullName
    executableSha256 = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
    executableVersion = $version
  }
}

function Read-OwnedProcess {
  $state = Read-InstanceState
  if ($null -eq $state) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  $requiredArguments = @("--remote-debugging-port=$Port", "--user-data-dir=$userData", '--isolated-test-instance', '--headless-test-instance')
  if ($process.ExecutablePath -ne $identity.executable -or $requiredArguments.Where({ -not $process.CommandLine.Contains($_) }).Count -gt 0) {
    throw "Le PID $($state.pid) ne porte pas l'identité headless complète de '$InstanceId'. Arrêt refusé."
  }
  return $process
}

$identity = Read-ExecutableIdentity

function Read-InstanceState {
  if (-not (Test-Path -LiteralPath $stateFile)) { return $null }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ($state.executable -ne $identity.executable -or $state.port -ne $Port -or $state.userData -ne $userData) {
    throw "L'identité persistée de '$InstanceId' ne correspond pas à la commande demandée."
  }
  return $state
}

if ($Action -eq 'Stop') {
  $owned = Read-OwnedProcess
  if ($null -ne $owned) {
    # ARRETER LE PARENT NE SUFFIT PAS. Mesure du 2026-09-12 : apres Stop-Process sur le seul PID
    # principal, les 5 process ENFANTS d'Electron (GPU, renderers, utilitaires) restaient vivants
    # et continuaient d'habiter le bureau isole. On arrete donc les enfants DIRECTS de ce PID —
    # eux seuls, jamais un binaire entier par son nom, qui emporterait l'app de l'utilisateur.
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $($owned.ProcessId)" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $identity.executable } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $owned.ProcessId -Force
  }
  if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile -Force }
  [pscustomobject]@{ instanceId = $InstanceId; status = 'stopped'; desktop = $nomBureau; port = $Port; executable = $identity.executable; executableSha256 = $identity.executableSha256; executableVersion = $identity.executableVersion } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'Status') {
  $state = Read-InstanceState
  $owned = Read-OwnedProcess
  try { $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 1 } catch { $pages = $null }
  $launchSha256 = if ($state -and $state.executableSha256) { $state.executableSha256 } else { $identity.executableSha256 }
  $launchVersion = if ($state -and $state.executableVersion) { $state.executableVersion } else { $identity.executableVersion }
  $executableMissing = $null -ne $state -and -not (Test-Path -LiteralPath $identity.executable -PathType Leaf)
  $executableDrift = if ($executableMissing) { $true } elseif ($launchSha256 -and $identity.executableSha256) { $launchSha256 -ne $identity.executableSha256 } else { $null }
  $executableDriftReason = if ($executableMissing) { 'missing' } elseif ($executableDrift) { 'sha256-mismatch' } else { $null }
  [pscustomobject]@{ instanceId = $InstanceId; desktop = $nomBureau; running = $null -ne $owned; cdpReady = $null -ne $pages; pid = if ($owned) { $owned.ProcessId } else { $null }; port = $Port; executable = if ($state) { $state.executable } else { $identity.executable }; executableSha256 = $launchSha256; executableVersion = $launchVersion; executableOnDiskSha256 = $identity.executableSha256; executableOnDiskVersion = $identity.executableVersion; executableDrift = $executableDrift; executableDriftReason = $executableDriftReason } | ConvertTo-Json -Compress
  exit $(if ($owned -and $pages) { 0 } else { 1 })
}

if (-not (Test-Path -LiteralPath $Executable)) { throw "Binaire introuvable : $Executable" }
if ([string]::IsNullOrWhiteSpace($identity.executableVersion)) { throw "Le binaire headless n'expose aucune version : $($identity.executable)" }
if ($null -ne (Read-OwnedProcess)) { throw "L'instance '$InstanceId' est déjà active." }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Le port CDP $Port est déjà occupé." }
New-Item -ItemType Directory -Path $userData, $appData -Force | Out-Null
# SEMENCE DU CATALOGUE DE MODELES. Sur un profil VIERGE, `loadCachedImportedModels` rend une liste
# VIDE (DEFAULT_IMPORTED_MODELS est vide) et `createDefaultTopology([])` leve : le demarrage s'arrete
# avant l'ouverture du port CDP, donc aucune instance isolee n'est pilotable. Mesure le 2026-09-06 :
# le process restait vivant et fige a 121 ms, juste avant le chargement de la topologie.
# La racine de donnees effective est `<user-data-dir>/app-data/autowin-os` (resolveInstanceAppDataBase
# puis autowinAppDataRoot). On ne remplace JAMAIS un cache existant : la semence est un amorcage.
$racineDonnees = Join-Path (Join-Path $userData 'app-data') 'autowin-os'
$cacheModeles = Join-Path $racineDonnees 'model-catalog.json'
if (-not (Test-Path -LiteralPath $cacheModeles)) {
  $semence = Join-Path (Join-Path $racineDepot 'scripts') 'fixtures/model-catalog-seed.json'
  if (-not (Test-Path -LiteralPath $semence -PathType Leaf)) { throw "Semence de catalogue introuvable : $semence" }
  New-Item -ItemType Directory -Path $racineDonnees -Force | Out-Null
  Copy-Item -LiteralPath $semence -Destination $cacheModeles -Force
}
$env:APPDATA = $appData
# `Start-Process` n'expose PAS STARTUPINFO.lpDesktop : c'est le seul champ qui fasse naitre le
# process dans un autre bureau. On passe donc par CreateProcess. Le PID vient de
# PROCESS_INFORMATION, donc tous les controles d'identite en aval (Read-OwnedProcess, Stop)
# restent inchanges.
$hBureau = [AutowinHdesk]::CreateDesktop($nomBureau, [IntPtr]::Zero, [IntPtr]::Zero, 0, [AutowinHdesk]::GENERIC_ALL, [IntPtr]::Zero)
if ($hBureau -eq [IntPtr]::Zero) { throw "CreateDesktop('$nomBureau') a echoue (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
$ligneCommande = New-Object System.Text.StringBuilder
[void]$ligneCommande.Append('"').Append($identity.executable).Append('"')
foreach ($argument in @("--remote-debugging-port=$Port", "--user-data-dir=$userData", '--isolated-test-instance', '--headless-test-instance')) {
  [void]$ligneCommande.Append(' "').Append($argument).Append('"')
}
$infoDemarrage = New-Object AutowinHdesk+STARTUPINFO
$infoDemarrage.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][AutowinHdesk+STARTUPINFO])
$infoDemarrage.lpDesktop = $nomBureau
$infoDemarrage.dwFlags = [AutowinHdesk]::STARTF_USESHOWWINDOW
$infoDemarrage.wShowWindow = [AutowinHdesk]::SW_SHOW
$infoProcessus = New-Object AutowinHdesk+PROCESS_INFORMATION
$lance = [AutowinHdesk]::CreateProcess($identity.executable, $ligneCommande, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, (Split-Path -Parent $identity.executable), [ref]$infoDemarrage, [ref]$infoProcessus)
if (-not $lance) {
  [void][AutowinHdesk]::CloseDesktop($hBureau)
  throw "CreateProcess sur le bureau '$nomBureau' a echoue (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
}
[void][AutowinHdesk]::CloseHandle($infoProcessus.hThread)
[void][AutowinHdesk]::CloseHandle($infoProcessus.hProcess)
# LE HANDLE DU BUREAU RESTE OUVERT JUSQU'A CE QUE CDP REPONDE. Mesure du 2026-09-12 : ferme juste
# apres CreateProcess, le process mourait en une fraction de seconde, sans code de sortie lisible
# et sans rien ecrire dans son profil. Entre la naissance du process et sa premiere fenetre,
# NOTRE handle est le seul titulaire du bureau : le lacher a cet instant detruit le bureau sous
# les pieds du process. C'est aussi ce que fait RigDesktop, qui ne ferme qu'au Dispose.
$process = Get-Process -Id $infoProcessus.dwProcessId
try {
  $launchedIdentity = Read-ExecutableIdentity
  if ($launchedIdentity.executable -ne $identity.executable -or $launchedIdentity.executableSha256 -ne $identity.executableSha256 -or $launchedIdentity.executableVersion -ne $identity.executableVersion) {
    throw "L'identité du binaire a changé pendant le lancement de '$InstanceId'."
  }
} catch {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw
}
@{ pid = $process.Id; desktop = $nomBureau; executable = $launchedIdentity.executable; executableSha256 = $launchedIdentity.executableSha256; executableVersion = $launchedIdentity.executableVersion; port = $Port; userData = $userData } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8

$deadline = (Get-Date).AddSeconds(20)
do {
  # `HasExited` n'est FIABLE que sur un objet issu de `Start-Process -PassThru`, qui conserve le
  # handle du process. Depuis que le lancement passe par CreateProcess, l'objet vient de
  # `Get-Process` : sans handle, .NET rendait HasExited VRAI sur un process bien vivant (et un
  # ExitCode VIDE, signature de l'incoherence). On interroge donc l'OS directement.
  if ($null -eq (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    [void][AutowinHdesk]::CloseDesktop($hBureau)
    throw "Autowin OS s'est arrêté avant que CDP soit prêt (bureau '$nomBureau', PID $($process.Id))."
  }
  try { $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 1 } catch { $pages = $null }
  if ($pages) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id }
    if (-not $listener) { throw "Le endpoint CDP $Port n'appartient pas au PID $($process.Id)." }
    # Le process tient desormais le bureau par ses propres fenetres : notre handle peut partir.
    [void][AutowinHdesk]::CloseDesktop($hBureau)
    [pscustomobject]@{ instanceId = $InstanceId; status = 'ready'; desktop = $nomBureau; pid = $process.Id; port = $Port; userData = $userData; webSocketDebuggerUrl = $pages[0].webSocketDebuggerUrl; executable = $launchedIdentity.executable; executableSha256 = $launchedIdentity.executableSha256; executableVersion = $launchedIdentity.executableVersion } | ConvertTo-Json -Compress
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
[void][AutowinHdesk]::CloseDesktop($hBureau)
throw "CDP indisponible sur le port $Port après 20 secondes."
