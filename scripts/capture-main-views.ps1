param(
  [string]$OutputDir = 'C:\Amitel\Autowin OS\artifacts\ui-system-sweep',
  [ValidateSet('Current', 'Noir')][string]$Theme = 'Current'
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AutowinMouse {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref Point point);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, UIntPtr wParam, IntPtr lParam);
}
'@

$process = Get-Process autowin-os -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'Autowin OS' } |
  Select-Object -First 1
if (-not $process) { throw 'Fenêtre Autowin OS introuvable.' }

$rect = New-Object AutowinMouse+Rect
if (-not [AutowinMouse]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Dimensions de fenêtre introuvables.' }
[AutowinMouse]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$views = @(
  @{ Name = 'chat'; Y = 101 },
  @{ Name = 'memory'; Y = 138 },
  @{ Name = 'observatory'; Y = 174 },
  @{ Name = 'models'; Y = 210 },
  @{ Name = 'capabilities'; Y = 246 },
  @{ Name = 'behaviour'; Y = 282 }
)

if ($Theme -eq 'Noir') {
  $themePoint = New-Object AutowinMouse+Point
  $themePoint.X = $rect.Left + 98
  $themePoint.Y = $rect.Bottom - 70
  $themeTarget = [AutowinMouse]::WindowFromPoint($themePoint)
  [AutowinMouse]::ScreenToClient($themeTarget, [ref]$themePoint) | Out-Null
  $themeLParam = [IntPtr](($themePoint.Y -shl 16) -bor ($themePoint.X -band 0xffff))
  [AutowinMouse]::PostMessage($themeTarget, 0x0201, [UIntPtr]::new(1), $themeLParam) | Out-Null
  [AutowinMouse]::PostMessage($themeTarget, 0x0202, [UIntPtr]::Zero, $themeLParam) | Out-Null
  Start-Sleep -Milliseconds 600
}

foreach ($view in $views) {
  [AutowinMouse]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 150
  $point = New-Object AutowinMouse+Point
  $point.X = $rect.Left + 100
  $point.Y = $rect.Top + $view.Y
  $target = [AutowinMouse]::WindowFromPoint($point)
  [AutowinMouse]::ScreenToClient($target, [ref]$point) | Out-Null
  $lParam = [IntPtr](($point.Y -shl 16) -bor ($point.X -band 0xffff))
  [AutowinMouse]::PostMessage($target, 0x0201, [UIntPtr]::new(1), $lParam) | Out-Null
  [AutowinMouse]::PostMessage($target, 0x0202, [UIntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 1200
  & powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\capture-printwindow.ps1" -Title 'Autowin OS' -Out "$OutputDir\$($view.Name).png"
}
