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
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr lp);
  public List<string> ZonesUnies = new List<string>();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  const uint PW_RENDERFULLCONTENT = 0x00000002;
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  const uint GENERIC_ALL = 0x10000000; const uint SRCCOPY = 0x00CC0020;

  // LISTE DES BUREAUX VIVANTS de la station courante. Un bureau cache disparait des que son
  // dernier handle se ferme (app quittee) : c'est la seule source de verite de « bureau ferme ».
  [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)] public delegate bool EnumDesktopProc(string name, IntPtr lp);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDesktopsW(IntPtr winsta, EnumDesktopProc cb, IntPtr lp);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  public static string[] ListDesktops() {
    var noms = new List<string>();
    EnumDesktopsW(GetProcessWindowStation(), (name, lp) => { noms.Add(name); return true; }, IntPtr.Zero);
    return noms.ToArray();
  }

  public static AutowinHdeskShot Capture(string desktopName, string outputPath) {
    return Capture(desktopName, outputPath, false);
  }

  // recadrer = true (petite TV) : l'image ne garde que la zone couverte par les fenetres. Sans cela
  // une petite fenetre se perd dans un ecran entier vide (mesure 2026-09-13 : charmap = un timbre
  // dans un coin de la TV). La detection « unie » reste faite sur l'ecran ENTIER, avant recadrage.
  public static AutowinHdeskShot Capture(string desktopName, string outputPath, bool recadrer) {
    var shot = new AutowinHdeskShot();
    var thread = new Thread(() => shot.Run(desktopName, outputPath, recadrer));
    thread.IsBackground = false;
    thread.Start();
    thread.Join();
    // FERMER LE HANDLE APRES LA FIN DU THREAD, jamais dans le thread. CloseDesktop echoue tant qu'un
    // thread du processus est attache au bureau : ferme depuis le thread de capture, le handle
    // fuyait et un processus de capture OUVERT (hdesk-tv.ps1) gardait le bureau en vie apres la
    // fermeture de l'app (mesure 2026-09-13 : charmap tue, bureau encore liste).
    if (shot.hDesk != IntPtr.Zero) { CloseDesktop(shot.hDesk); shot.hDesk = IntPtr.Zero; }
    return shot;
  }

  IntPtr hDesk = IntPtr.Zero;
  void Run(string desktopName, string outputPath, bool recadrer) {
    int zoneG = int.MaxValue, zoneH = int.MaxValue, zoneD = int.MinValue, zoneB = int.MinValue;
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
              if (dessine) {
                g.DrawImage(vue, r.Left, r.Top); Painted++;
                zoneG = Math.Min(zoneG, r.Left); zoneH = Math.Min(zoneH, r.Top);
                zoneD = Math.Max(zoneD, r.Right); zoneB = Math.Max(zoneB, r.Bottom);
              }
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
        // UNE VUE GPU N'EST PAS CAPTUREE SUR UN BUREAU CACHE. Mesure du 2026-09-13 (Roblox Studio,
        // Direct3D11) : la fenetre de rendu 3D reste d'UNE couleur avec PrintWindow(0),
        // PrintWindow(PW_RENDERFULLCONTENT) et BitBlt — sans compositeur, la surface de rendu n'est
        // lisible nulle part — alors que l'image entiere, avec les panneaux autour, semblait
        // valide (19 couleurs, uni=false). On signale donc chaque GRANDE fenetre enfant restee unie :
        // la capture ne prouve rien de ce qu'elle devait montrer. Calcule sur l'ecran ENTIER, avant
        // tout recadrage (petite TV).
        var vues = new HashSet<string>();
        foreach (var top in fenetres) {
          EnumChildWindows(top, (enfant, lp) => {
            RECT rc;
            if (!IsWindowVisible(enfant) || !GetWindowRect(enfant, out rc)) return true;
            int ex0 = Math.Max(rc.Left, 0), ey0 = Math.Max(rc.Top, 0);
            int ex1 = Math.Min(rc.Right, Width), ey1 = Math.Min(rc.Bottom, Height);
            if (ex1 - ex0 < 300 || ey1 - ey0 < 200) return true;
            var cz = new HashSet<int>();
            for (int i = 0; i < 12; i++) for (int j = 0; j < 12; j++)
              cz.Add(image.GetPixel(ex0 + (ex1 - ex0 - 1) * i / 11, ey0 + (ey1 - ey0 - 1) * j / 11).ToArgb());
            if (cz.Count == 1) vues.Add(ex0 + "," + ey0 + " " + (ex1 - ex0) + "x" + (ey1 - ey0));
            return true;
          }, IntPtr.Zero);
        }
        ZonesUnies.AddRange(vues);
        int x0 = Math.Max(0, zoneG - 8), y0 = Math.Max(0, zoneH - 8);
        int x1 = Math.Min(Width, zoneD + 8), y1 = Math.Min(Height, zoneB + 8);
        if (recadrer && Painted > 0 && x1 - x0 > 16 && y1 - y0 > 16) {
          using (var zone = image.Clone(new Rectangle(x0, y0, x1 - x0, y1 - y0), image.PixelFormat)) {
            zone.Save(outputPath, ImageFormat.Png);
          }
          Width = x1 - x0; Height = y1 - y0;
        } else {
          image.Save(outputPath, ImageFormat.Png);
        }
      }
      Bytes = new System.IO.FileInfo(outputPath).Length;
    } catch (Exception ex) { Error = ex.GetType().Name + " : " + ex.Message; }
  }
}
