using System;
using System.Runtime.InteropServices;
using System.Threading;
// AGIR DANS UN BUREAU CACHE (HDESK) : clic et frappe par MESSAGES FENETRE. SendInput est exclu :
// il vise le bureau d'ENTREE, donc l'ecran de l'utilisateur. Le thread s'attache au bureau cache
// avant tout, comme hdesk-shot.cs, pour que WindowFromPoint cherche dans CE bureau.
public sealed class AutowinHdeskAct {
  public string Error; public string Cible; public int Envoyes;
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n, uint f, bool i, uint a);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  const uint WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_CHAR = 0x102, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101;
  IntPtr hDesk;
  public static AutowinHdeskAct Run(string bureau, int x, int y, string texte, bool entree) {
    var a = new AutowinHdeskAct();
    var t = new Thread(() => a.Go(bureau, x, y, texte, entree)); t.Start(); t.Join();
    if (a.hDesk != IntPtr.Zero) CloseDesktop(a.hDesk);
    return a;
  }
  void Go(string bureau, int x, int y, string texte, bool entree) {
    hDesk = OpenDesktopW(bureau, 0, false, 0x10000000);
    if (hDesk == IntPtr.Zero) { Error = "Bureau '" + bureau + "' introuvable (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    if (!SetThreadDesktop(hDesk)) { Error = "SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    var p = new POINT { X = x, Y = y };
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) { Error = "Aucune fenetre en (" + x + "," + y + ") dans ce bureau."; return; }
    var sb = new System.Text.StringBuilder(256); GetClassNameW(h, sb, 256); Cible = sb.ToString();
    var c = p; ScreenToClient(h, ref c);
    IntPtr lp = new IntPtr((c.Y << 16) | (c.X & 0xFFFF));
    PostMessageW(h, WM_LBUTTONDOWN, new IntPtr(1), lp); PostMessageW(h, WM_LBUTTONUP, IntPtr.Zero, lp); Envoyes += 2;
    Thread.Sleep(150);
    foreach (char ch in texte ?? "") { PostMessageW(h, WM_CHAR, new IntPtr(ch), new IntPtr(1)); Envoyes++; }
    if (entree) { PostMessageW(h, WM_KEYDOWN, new IntPtr(0x0D), new IntPtr(1)); PostMessageW(h, WM_CHAR, new IntPtr(13), new IntPtr(1)); PostMessageW(h, WM_KEYUP, new IntPtr(0x0D), new IntPtr(unchecked((int)0xC0000001))); Envoyes += 3; }
  }
}
