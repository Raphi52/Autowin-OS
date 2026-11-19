using System;
using System.Runtime.InteropServices;
using System.Threading;
// GLISSER DANS UN BUREAU CACHE (HDESK) : appui, deplacement pas a pas, relache, par MESSAGES FENETRE.
// Meme parti que hdesk-act.cs (clic) : SendInput viserait le bureau d'ENTREE, donc l'ecran de
// l'utilisateur ; le thread s'attache au bureau cache, et l'etat du bouton gauche est pose dans la
// file d'entree partagee de la cible (AttachThreadInput), sans quoi une appli qui relit l'etat reel
// du bouton (WPF, Chromium) verrait un deplacement « bouton relache ».
// Pourquoi (conv-1997, 19/11/2026) : prouver le glisser-deposer de tuiles d'une application WebView2 sur le
// bureau cache ; hdesk-act ne sait que cliquer.
public sealed class AutowinHdeskGlisser {
  public string Error; public string Cible; public int Envoyes;
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n, uint f, bool i, uint a);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] static extern bool GetKeyboardState(byte[] s);
  [DllImport("user32.dll")] static extern bool SetKeyboardState(byte[] s);
  [DllImport("user32.dll")] static extern bool PeekMessageW(out MSG m, IntPtr h, uint a, uint b, uint r);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr H; public uint M; public IntPtr W, L; public uint T; public POINT P; }
  const uint WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202;
  const int MK_LBUTTON = 1;
  IntPtr hDesk;

  static void BoutonGauche(bool enfonce) { var k = new byte[256]; if (GetKeyboardState(k)) { k[0x01] = (byte)(enfonce ? 0x80 : 0); SetKeyboardState(k); } }
  // Attend que la cible ait traite ce qui est poste avant (deux allers-retours WM_NULL, 2 s au plus).
  static void Synchro(IntPtr h) { IntPtr r; for (int i = 0; i < 2; i++) { SendMessageTimeoutW(h, 0, IntPtr.Zero, IntPtr.Zero, 2, 2000, out r); Thread.Sleep(15); } }

  public static AutowinHdeskGlisser Run(string bureau, int x1, int y1, int x2, int y2, int pas, int pauseMs) {
    var a = new AutowinHdeskGlisser();
    var t = new Thread(() => a.Go(bureau, x1, y1, x2, y2, pas, pauseMs)); t.Start(); t.Join();
    if (a.hDesk != IntPtr.Zero) CloseDesktop(a.hDesk);
    return a;
  }

  IntPtr Point(IntPtr h, int x, int y) {
    var c = new POINT { X = x, Y = y }; ScreenToClient(h, ref c);
    return new IntPtr((c.Y << 16) | (c.X & 0xFFFF));
  }

  void Go(string bureau, int x1, int y1, int x2, int y2, int pas, int pauseMs) {
    SetThreadDpiAwarenessContext(new IntPtr(-4)); // pixels physiques, ceux de hdesk-observe
    hDesk = OpenDesktopW(bureau, 0, false, 0x10000000);
    if (hDesk == IntPtr.Zero) { Error = "Bureau '" + bureau + "' introuvable (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    if (!SetThreadDesktop(hDesk)) { Error = "SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    // Tout le geste part a la fenetre sous le point de DEPART : c'est elle qui a capture le pointeur.
    IntPtr h = WindowFromPoint(new POINT { X = x1, Y = y1 });
    if (h == IntPtr.Zero) { Error = "Aucune fenetre en (" + x1 + "," + y1 + ") dans ce bureau."; return; }
    var sb = new System.Text.StringBuilder(256); GetClassNameW(h, sb, 256); Cible = sb.ToString();
    MSG m; PeekMessageW(out m, IntPtr.Zero, 0, 0, 0); // file de messages de ce thread, requise par AttachThreadInput
    uint pid, moi = GetCurrentThreadId(), cible = GetWindowThreadProcessId(h, out pid);
    bool lie = cible != 0 && cible != moi && AttachThreadInput(moi, cible, true);
    try {
      PostMessageW(h, WM_MOUSEMOVE, IntPtr.Zero, Point(h, x1, y1)); Envoyes++; Synchro(h);
      if (lie) BoutonGauche(true);
      PostMessageW(h, WM_LBUTTONDOWN, new IntPtr(MK_LBUTTON), Point(h, x1, y1)); Envoyes++; Synchro(h);
      int n = Math.Max(1, pas);
      for (int i = 1; i <= n; i++) {
        int x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
        PostMessageW(h, WM_MOUSEMOVE, new IntPtr(MK_LBUTTON), Point(h, x, y)); Envoyes++; Synchro(h);
        Thread.Sleep(Math.Max(0, pauseMs));
      }
      if (lie) BoutonGauche(false);
      PostMessageW(h, WM_LBUTTONUP, IntPtr.Zero, Point(h, x2, y2)); Envoyes++; Synchro(h);
    } finally {
      if (lie) { BoutonGauche(false); AttachThreadInput(moi, cible, false); }
    }
  }
}
