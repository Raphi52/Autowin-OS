param([string]$TitleLike = "Electron", [string]$Out = "C:\Amitel\Autowin OS\p0-capture.png")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;using System.Runtime.InteropServices;
public class W{
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr ShowWindow(IntPtr h,int n);
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int Left,Top,Right,Bottom;}
}
"@
$p = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and
  $_.MainWindowTitle -like "*$TitleLike*" -and
  $_.ProcessName -in @('electron', 'autowin-os')
} | Select-Object -First 1
if(-not $p){ Write-Host "fenetre introuvable"; exit 2 }
[W]::ShowWindow($p.MainWindowHandle,9) | Out-Null
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object W+RECT
[W]::GetWindowRect($p.MainWindowHandle,[ref]$r) | Out-Null
$w = $r.Right-$r.Left; $h = $r.Bottom-$r.Top
if($w -le 0 -or $h -le 0){ Write-Host "rect invalide"; exit 3 }
$bmp = New-Object System.Drawing.Bitmap $w,$h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size)
$bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "OK $Out ${w}x${h}"
