<#
  OBSERVER un BUREAU WINDOWS ISOLE (HDESK) : rend une capture de TOUT le bureau, pas seulement
  de la fenetre de l'app. C'est la difference qui compte — une boite de dialogue systeme, un
  crash Windows ou une fenetre parasite naissent DANS ce bureau et n'apparaissent nulle part
  ailleurs. La capture par le port de debogage de l'app, elle, ne voit que la page.

  Le thread s'attache au bureau (SetThreadDesktop) AVANT de demander son contexte d'affichage :
  sans cette attache, GetDC rendrait le bureau interactif de l'utilisateur, donc une capture de
  SON ecran — l'inverse exact de ce qu'on cherche.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }

Add-Type -AssemblyName System.Drawing
# TOUTE LA CAPTURE VIT DANS UN THREAD NEUF. Mesure du 2026-09-12 : appele depuis le thread
# principal de PowerShell, SetThreadDesktop echoue avec Win32 170 (ERROR_BUSY) — un thread qui
# possede deja des fenetres ne peut PAS changer de bureau. Meme parade que RigDesktop.cs : un
# thread cree pour l'occasion, qui s'attache AVANT de toucher quoi que ce soit de graphique.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
public sealed class AutowinHdeskShot {
  public string Error; public int Width, Height, Distinct, Windows, Painted; public long Bytes;
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDesktopWindows(IntPtr hDesk, EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  const uint PW_RENDERFULLCONTENT = 0x00000002;
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  const uint GENERIC_ALL = 0x10000000; const uint SRCCOPY = 0x00CC0020;

  public static AutowinHdeskShot Capture(string desktopName, string outputPath) {
    var shot = new AutowinHdeskShot();
    var thread = new Thread(() => shot.Run(desktopName, outputPath));
    thread.IsBackground = false;
    thread.Start();
    thread.Join();
    return shot;
  }

  void Run(string desktopName, string outputPath) {
    IntPtr hDesk = IntPtr.Zero;
    try {
      try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
      hDesk = OpenDesktopW(desktopName, 0, false, GENERIC_ALL);
      if (hDesk == IntPtr.Zero) { Error = "Bureau '" + desktopName + "' introuvable (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
      if (!SetThreadDesktop(hDesk)) { Error = "SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
      Width = GetSystemMetrics(0); Height = GetSystemMetrics(1);
      if (Width <= 0 || Height <= 0) { Error = "Le bureau ne rend aucune dimension (" + Width + "x" + Height + ")."; return; }
      // UN BUREAU NON AFFICHE N'A PAS D'ECRAN. Mesure du 2026-09-12 : BitBlt sur le contexte
      // d'affichage du bureau ECHOUE — il n'y a aucune surface a copier, faute de compositeur.
      // On demande donc a CHAQUE FENETRE de se dessiner elle-meme (PrintWindow), puis on les pose
      // a leur position reelle. C'est ce qui rend visibles les boites de dialogue et les fenetres
      // parasites, que la capture par le port de debogage de l'app ne montrerait jamais.
      var fenetres = new List<IntPtr>();
      EnumDesktopWindows(hDesk, (hwnd, lp) => { if (IsWindowVisible(hwnd)) fenetres.Add(hwnd); return true; }, IntPtr.Zero);
      Windows = fenetres.Count;
      using (var image = new Bitmap(Width, Height)) {
        using (var g = Graphics.FromImage(image)) {
          g.Clear(Color.FromArgb(24, 24, 28));
          foreach (var hwnd in fenetres) {
            RECT r;
            if (!GetWindowRect(hwnd, out r)) continue;
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            if (w <= 1 || h <= 1 || w > 20000 || h > 20000) continue;
            using (var vue = new Bitmap(w, h))
            using (var gv = Graphics.FromImage(vue)) {
              IntPtr dcVue = gv.GetHdc();
              bool dessine = PrintWindow(hwnd, dcVue, PW_RENDERFULLCONTENT);
              gv.ReleaseHdc(dcVue);
              if (dessine) { g.DrawImage(vue, r.Left, r.Top); Painted++; }
            }
          }
        }
        // UNE CAPTURE UNIE N'EST PAS UNE OBSERVATION : un bureau sans surface de dessin rend un
        // aplat. L'image existerait et ne prouverait rien. On echantillonne une GRILLE, jamais la
        // diagonale : une fenetre posee hors de cette diagonale — un dialogue dans un coin — la
        // traversait sans etre vue, et l'observation etait declaree unie alors qu'elle montrait
        // quelque chose (mesure du 2026-09-12 sur un rappel Outlook ouvert dans le bureau isole).
        var couleurs = new HashSet<int>();
        for (int cx = 0; cx < 48; cx++) {
          for (int cy = 0; cy < 27; cy++) {
            int x = Math.Min(Width * cx / 48, Width - 1), y = Math.Min(Height * cy / 27, Height - 1);
            couleurs.Add(image.GetPixel(x, y).ToArgb());
          }
        }
        Distinct = couleurs.Count;
        image.Save(outputPath, ImageFormat.Png);
      }
      Bytes = new System.IO.FileInfo(outputPath).Length;
    } catch (Exception ex) { Error = ex.GetType().Name + " : " + ex.Message; }
    finally { if (hDesk != IntPtr.Zero) CloseDesktop(hDesk); }
  }
}
'@

$racineDepot = Split-Path -Parent $PSScriptRoot
$nomBureau = "AutowinTest_$InstanceId"
if ([string]::IsNullOrWhiteSpace($Output)) {
  $dossier = Join-Path (Join-Path $racineDepot 'Audit') 'hdesk-observe'
  New-Item -ItemType Directory -Path $dossier -Force | Out-Null
  $Output = Join-Path $dossier "$InstanceId-$(Get-Date -Format 'yyyyMMdd-HHmmss').png"
}

$resultat = [AutowinHdeskShot]::Capture($nomBureau, $Output)
if ($resultat.Error) { throw $resultat.Error }
[pscustomobject]@{
  instanceId = $InstanceId; desktop = $nomBureau; width = $resultat.Width; height = $resultat.Height
  fenetres = $resultat.Windows; fenetresDessinees = $resultat.Painted
  couleursDistinctes = $resultat.Distinct; uni = ($resultat.Distinct -le 1); octets = $resultat.Bytes; output = $Output
} | ConvertTo-Json -Compress
if ($resultat.Distinct -le 1) { exit 2 }
exit 0
