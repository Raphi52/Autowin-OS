<#
  LANCER UNE APPLICATION HORS DE LA ZONE VISIBLE DE LA SESSION, ATTENDRE, PUIS LA CAPTURER — 3D COMPRISE.

  Pourquoi (conv-526, 2026-09-13) : sur un bureau cache (hdesk-lancer.ps1), un rendu GPU (Direct3D11)
  n'est compose par personne et reste d'une seule couleur (hdesk-observe.ps1 le signale, code 3).
  Dans la session courante, Windows compose chaque fenetre meme hors ecran : PrintWindow
  (PW_RENDERFULLCONTENT) la lit. Mesure : vue 3D de Roblox Studio 812x675 = 251 couleurs ici,
  1 couleur sur le bureau cache.

  Deroule : lancement REDUIT -> chaque fenetre du processus est restauree directement a -30000,-30000
  sans activation, et retiree de la barre des taches -> attente -> capture de la plus grande fenetre ->
  arret du SEUL processus lance.

  Limites mesurees : ~0,3 s entre le lancement et la prise en charge (le bouton reduit peut
  apparaitre brievement dans la barre des taches) ; pas de clic ni de clavier ; tourne dans la
  session de l'utilisateur (memes fichiers, memes droits) — preferer hdesk-lancer.ps1 hors besoin 3D.

  Usage : powershell -NoProfile -File scripts/hors-ecran-capture.ps1 -Executable "<app.exe>" [-Arguments "<args>"] [-AttenteSecondes 30] [-Output capture.png]
  Sortie JSON ; code 3 si la vue principale reste unie.
#>
param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [string]$Arguments = '',
  [int]$AttenteSecondes = 30,
  [int]$Rafale = 1,               # nombre de captures dans la MEME session (diagnostic)
  [int]$IntervalleSecondes = 3,
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable introuvable : $Executable" }
if ([string]::IsNullOrWhiteSpace($Output)) {
  $dossier = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'Audit') 'hors-ecran'
  New-Item -ItemType Directory -Path $dossier -Force | Out-Null
  $Output = Join-Path $dossier ("capture-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
}
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Collections.Generic; using System.Diagnostics; using System.Drawing; using System.Drawing.Imaging;
using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class HorsEcran {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, P cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  public struct R { public int L, T, Ri, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WP { public int length, flags, showCmd; public PT min, max; public R rc; }
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WP p);
  [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref WP p);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
  const int GWL_EXSTYLE = -20; const long WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
  const uint SWP_NOSIZE = 1, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;
  public static List<IntPtr> Tops(int pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  // Deplace + retire de la barre des taches ; rend le nombre de fenetres traitees et le 1er instant visible.
  public static string Garder(int pid, int millis) {
    var vus = new HashSet<long>(); var sw = Stopwatch.StartNew(); long premier = -1;
    while (sw.ElapsedMilliseconds < millis) {
      foreach (var h in Tops(pid)) {
        if (vus.Contains(h.ToInt64())) {
          R rr; GetWindowRect(h, out rr);
          if (rr.L > -20000 && !IsIconic(h)) SetWindowPos(h, IntPtr.Zero, -30000, -30000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
          continue;
        }
        if (premier < 0) premier = sw.ElapsedMilliseconds;
        var ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
        SetWindowLongPtr(h, GWL_EXSTYLE, new IntPtr((ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW));
        // Restaure DEPUIS l'etat reduit directement a une position hors zone visible, sans activer :
        // la fenetre ne passe jamais par l'ecran de l'utilisateur.
        var wp = new WP(); wp.length = Marshal.SizeOf(typeof(WP));
        GetWindowPlacement(h, ref wp);
        int w = Math.Max(wp.rc.Ri - wp.rc.L, 1280), hh = Math.Max(wp.rc.B - wp.rc.T, 800);
        wp.rc.L = -30000; wp.rc.T = -30000; wp.rc.Ri = -30000 + w; wp.rc.B = -30000 + hh;
        wp.showCmd = 4; // SW_SHOWNOACTIVATE
        SetWindowPlacement(h, ref wp);
        vus.Add(h.ToInt64());
      }
      Thread.Sleep(15);
    }
    return "fenetres=" + vus.Count + " premiereApparitionMs=" + premier;
  }
  public static string Capturer(int pid, string outPath) {
    IntPtr best = IntPtr.Zero; int aire = 0;
    foreach (var h in Tops(pid)) { R r; GetWindowRect(h, out r); int a = (r.Ri - r.L) * (r.B - r.T); if (a > aire) { aire = a; best = h; } }
    if (best == IntPtr.Zero) return "aucune fenetre";
    R w; GetWindowRect(best, out w); int W = w.Ri - w.L, H = w.B - w.T;
    using (var b = new Bitmap(W, H)) {
      using (var g = Graphics.FromImage(b)) { var dc = g.GetHdc(); PrintWindow(best, dc, 2); g.ReleaseHdc(dc); }
      b.Save(outPath, ImageFormat.Png);
      var sb = new StringBuilder("fenetre=" + W + "x" + H + " pos=" + w.L + "," + w.T + " reduite=" + IsIconic(best) + " visible=" + IsWindowVisible(best) + " figee=" + IsHungAppWindow(best) + " fenetresProcessus=" + Tops(pid).Count);
      EnumChildWindows(best, (c, l) => {
        R rc; GetWindowRect(c, out rc); int cw = rc.Ri - rc.L, ch = rc.B - rc.T;
        if (!IsWindowVisible(c) || cw < 600 || ch < 400) return true;
        var s = new HashSet<int>();
        for (int i = 0; i < 16; i++) for (int j = 0; j < 16; j++) {
          int x = rc.L - w.L + (cw - 1) * i / 15, y = rc.T - w.T + (ch - 1) * j / 15;
          if (x >= 0 && y >= 0 && x < W && y < H) s.Add(b.GetPixel(x, y).ToArgb());
        }
        sb.Append(" | vue " + cw + "x" + ch + " couleurs=" + s.Count);
        return true;
      }, IntPtr.Zero);
      return sb.ToString();
    }
  }
}
'@
$p = $null
try {
  $p = if ($Arguments) { Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Minimized -PassThru } else { Start-Process -FilePath $Executable -WindowStyle Minimized -PassThru }
  $garde = [HorsEcran]::Garder($p.Id, $AttenteSecondes * 1000)
  $capture = [HorsEcran]::Capturer($p.Id, $Output)
  # Rafale : captures supplementaires dans la meme session, pour distinguer un blanc PASSAGER
  # (images sautees) d'un blanc de SESSION (fenetre jamais redessinee).
  for ($i = 2; $i -le $Rafale; $i++) {
    $garde = $garde + ' | ' + [HorsEcran]::Garder($p.Id, $IntervalleSecondes * 1000)
    $sortieI = [IO.Path]::ChangeExtension($Output, $null).TrimEnd('.') + "-$i.png"
    $capture = $capture + " || capture$i " + [HorsEcran]::Capturer($p.Id, $sortieI)
  }
  $vues = @([regex]::Matches(($capture -split ' \|\| ')[0], 'vue (\d+x\d+) couleurs=(\d+)') | ForEach-Object { [pscustomobject]@{ taille = $_.Groups[1].Value; couleurs = [int]$_.Groups[2].Value } })
  $unie = ($vues.Count -gt 0) -and (($vues | Where-Object couleurs -le 1).Count -gt 0)
  [pscustomobject]@{ pid = $p.Id; prise = $garde; capture = $capture; vuesUnies = $unie; output = $Output } | ConvertTo-Json -Compress
  if ($unie) { exit 3 }
} finally {
  if ($p) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue }
}
