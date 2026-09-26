# Outil de notation juge t4 (conv-826) : capture et pilote l'ECRAN REEL de l'utilisateur,
# a sa demande explicite (« sur mon ecran reel »). Coordonnees en pixels physiques de l'ecran.
param(
  [ValidateSet('shot','click','dclick','key','focus','move','idle','wheel','fg','reset')][string]$Action = 'shot',
  [string]$Out = '',
  [int]$X = 0, [int]$Y = 0,
  [string]$Keys = '',
  [string]$TitleLike = 'Roblox Studio',
  [int]$Delta = -120
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class U {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
[U]::SetProcessDPIAware() | Out-Null
$w = [U]::GetSystemMetrics(0); $h = [U]::GetSystemMetrics(1)
# Garde-fou : si l'utilisateur a touche souris/clavier depuis notre dernier geste, on s'arrete (code 9).
$marque = Join-Path $env:TEMP 'ecran-juge-t4.tick'
function Idle { $l = New-Object U+LII; $l.cbSize = 8; [U]::GetLastInputInfo([ref]$l) | Out-Null; [Environment]::TickCount - $l.dwTime }
function FgProc { $pid0 = 0; [U]::GetWindowThreadProcessId([U]::GetForegroundWindow(), [ref]$pid0) | Out-Null; (Get-Process -Id $pid0 -ErrorAction SilentlyContinue).ProcessName }
if ($Action -in @('click','dclick','key','wheel','move','focus')) {
  if (Test-Path $marque) {
    $depuis = [Environment]::TickCount - [int64](Get-Content $marque)
    $idle = Idle
    if ($idle + 400 -lt $depuis) { Write-Output "STOP utilisateur actif (entree il y a $idle ms, notre dernier geste il y a $depuis ms)"; exit 9 }
  }
}
switch ($Action) {
  'shot' {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "OK $Out ${w}x${h}"
  }
  'move'   { [U]::SetCursorPos($X, $Y) | Out-Null; Write-Output "move $X,$Y" }
  'click'  { [U]::SetCursorPos($X, $Y) | Out-Null; Start-Sleep -Milliseconds 80
             [U]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60
             [U]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero); Write-Output "click $X,$Y" }
  'dclick' { [U]::SetCursorPos($X, $Y) | Out-Null; Start-Sleep -Milliseconds 80
             1..2 | % { [U]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); [U]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 90 }
             Write-Output "dclick $X,$Y" }
  'wheel'  { [U]::SetCursorPos($X, $Y) | Out-Null; [U]::mouse_event(0x0800,0,0,$Delta,[UIntPtr]::Zero); Write-Output "wheel $Delta" }
  'focus'  {
    $p = Get-Process RobloxStudioBeta -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleLike*" } | Select-Object -First 1
    if (-not $p) { Write-Output 'fenetre Studio introuvable'; exit 2 }
    [U]::ShowWindow($p.MainWindowHandle, 3) | Out-Null
    [U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Write-Output "focus $($p.Id) $($p.MainWindowTitle)"
  }
  'key'    { $fp = FgProc; if ($fp -ne 'RobloxStudioBeta') { Write-Output "REFUS touche : premier plan = $fp"; exit 8 }
             [System.Windows.Forms.SendKeys]::SendWait($Keys); Write-Output "key $Keys" }
  'fg'     { Write-Output ("fg=" + (FgProc)) }
  'reset'  { Remove-Item $marque -ErrorAction SilentlyContinue; Write-Output 'reset' }
  'idle'   { $l = New-Object U+LII; $l.cbSize = 8; [U]::GetLastInputInfo([ref]$l) | Out-Null
             Write-Output ("idle_ms=" + ([Environment]::TickCount - $l.dwTime)) }
}
if ($Action -in @('click','dclick','key','wheel','move','focus')) { Start-Sleep -Milliseconds 150; Set-Content $marque ([Environment]::TickCount) }
