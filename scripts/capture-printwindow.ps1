param([string]$Title="Electron",[string]$Out="C:\Amitel\Autowin OS\p0-capture.png")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;using System.Runtime.InteropServices;
public class PW{
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int Left,Top,Right,Bottom;}
}
"@
$p = Get-Process | ?{ $_.MainWindowTitle -eq $Title -and $_.ProcessName -eq 'electron' } | Select -First 1
if(-not $p){ Write-Host "introuvable"; exit 2 }
$r = New-Object PW+RECT; [PW]::GetWindowRect($p.MainWindowHandle,[ref]$r) | Out-Null
$w=$r.Right-$r.Left; $h=$r.Bottom-$r.Top
$bmp = New-Object System.Drawing.Bitmap $w,$h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT (capture le contenu Chromium meme en arriere-plan)
$ok = [PW]::PrintWindow($p.MainWindowHandle,$hdc,2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "PrintWindow=$ok $Out ${w}x${h}"
