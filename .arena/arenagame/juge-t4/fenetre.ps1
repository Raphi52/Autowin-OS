# Capture d'une fenetre Studio par PrintWindow(PW_RENDERFULLCONTENT) + clic/touche par messages
# fenetre (PostMessage) : marche meme quand l'affichage du bureau a distance est reduit (conv-826).
param(
  [ValidateSet('shot','click','key','list')][string]$Action = 'shot',
  [int]$ProcessId = 0,
  [string]$Out = '',
  [int]$X = 0, [int]$Y = 0,
  [int]$Vk = 0,
  [string]$TitleLike = ''
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public class F {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Of(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }
}
"@
[F]::SetProcessDPIAware() | Out-Null
$wins = [F]::Of([uint32]$ProcessId)
if ($TitleLike) { $wins = @($wins | Where-Object { [F]::Title($_) -like "*$TitleLike*" }) }
if ($Action -eq 'list') {
  foreach ($h in $wins) { $r = New-Object F+RECT; [F]::GetWindowRect($h, [ref]$r) | Out-Null
    Write-Output ("{0} [{1}] {2},{3} {4}x{5}" -f $h, [F]::Title($h), $r.Left, $r.Top, ($r.Right-$r.Left), ($r.Bottom-$r.Top)) }
  exit 0
}
# fenetre cible = la plus grande visible du processus (filtree par titre si donne)
$best = $null; $area = 0
foreach ($h in $wins) { $r = New-Object F+RECT; [F]::GetWindowRect($h, [ref]$r) | Out-Null
  $a = ($r.Right-$r.Left) * ($r.Bottom-$r.Top); if ($a -gt $area) { $area = $a; $best = $h } }
if (-not $best) { Write-Output 'aucune fenetre'; exit 2 }
$r = New-Object F+RECT; [F]::GetWindowRect($best, [ref]$r) | Out-Null
$w = $r.Right-$r.Left; $hh = $r.Bottom-$r.Top
switch ($Action) {
  'shot' {
    $bmp = New-Object System.Drawing.Bitmap $w, $hh
    $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
    $ok = [F]::PrintWindow($best, $dc, 2); $g.ReleaseHdc($dc)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "OK printwindow=$ok $Out ${w}x${hh} [$([F]::Title($best))]"
  }
  'click' {  # X,Y = coordonnees dans la capture de CETTE fenetre -> converties en coordonnees client
    $pt = New-Object F+PT; [F]::ClientToScreen($best, [ref]$pt) | Out-Null
    $cx = $X - ($pt.X - $r.Left); $cy = $Y - ($pt.Y - $r.Top)
    $lp = [IntPtr](($cy -shl 16) -bor ($cx -band 0xFFFF))
    [F]::PostMessageW($best, 0x0200, [IntPtr]::Zero, $lp) | Out-Null
    [F]::PostMessageW($best, 0x0201, [IntPtr]1, $lp) | Out-Null
    Start-Sleep -Milliseconds 60
    [F]::PostMessageW($best, 0x0202, [IntPtr]::Zero, $lp) | Out-Null
    Write-Output "click $X,$Y (client $cx,$cy) -> [$([F]::Title($best))]"
  }
  'key' {
    [F]::PostMessageW($best, 0x0100, [IntPtr]$Vk, [IntPtr]1) | Out-Null
    Start-Sleep -Milliseconds 60
    [F]::PostMessageW($best, 0x0101, [IntPtr]$Vk, [IntPtr]([int]0xC0000001 -band 0x7FFFFFFF)) | Out-Null
    Write-Output "key vk=$Vk -> [$([F]::Title($best))]"
  }
}
