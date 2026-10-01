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
  // TOUCHES NOMMEES (conv-35) : touche -> (code virtuel, caractere WM_CHAR ou 0). Les combinaisons Ctrl
  // passent par leur caractere de controle (Ctrl+A=1, C=3, V=22, X=24, Z=26) : un message poste ne
  // change pas l'etat reel de Ctrl, donc un WM_KEYDOWN 'C' serait lu comme un simple « c ». Les champs
  // Windows natifs comprennent ces caracteres ; une page web peut les ignorer.
  static readonly System.Collections.Generic.Dictionary<string, int[]> Touches = new System.Collections.Generic.Dictionary<string, int[]>(StringComparer.OrdinalIgnoreCase) {
    {"Tab", new[]{0x09, 9}}, {"Echap", new[]{0x1B, 27}}, {"Retour", new[]{0x08, 8}}, {"Entree", new[]{0x0D, 13}},
    {"Suppr", new[]{0x2E, 0}}, {"Haut", new[]{0x26, 0}}, {"Bas", new[]{0x28, 0}}, {"Gauche", new[]{0x25, 0}},
    {"Droite", new[]{0x27, 0}}, {"Debut", new[]{0x24, 0}}, {"Fin", new[]{0x23, 0}}, {"PageHaut", new[]{0x21, 0}},
    {"PageBas", new[]{0x22, 0}}, {"CtrlA", new[]{0, 1}}, {"CtrlC", new[]{0, 3}}, {"CtrlV", new[]{0, 22}},
    {"CtrlX", new[]{0, 24}}, {"CtrlZ", new[]{0, 26}}
  };
  public static bool ToucheConnue(string t) { return Touches.ContainsKey(t ?? ""); }
  public static AutowinHdeskAct Run(string bureau, int x, int y, string texte, bool entree) { return Run(bureau, x, y, texte, entree, "", 0, false); }
  public static AutowinHdeskAct Run(string bureau, int x, int y, string texte, bool entree, string touche, int molette, bool sansClic) {
    var a = new AutowinHdeskAct();
    var t = new Thread(() => a.Go(bureau, x, y, texte, entree, touche, molette, sansClic)); t.Start(); t.Join();
    if (a.hDesk != IntPtr.Zero) CloseDesktop(a.hDesk);
    return a;
  }
  void Go(string bureau, int x, int y, string texte, bool entree, string touche, int molette, bool sansClic) {
    hDesk = OpenDesktopW(bureau, 0, false, 0x10000000);
    if (hDesk == IntPtr.Zero) { Error = "Bureau '" + bureau + "' introuvable (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    if (!SetThreadDesktop(hDesk)) { Error = "SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    var p = new POINT { X = x, Y = y };
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) { Error = "Aucune fenetre en (" + x + "," + y + ") dans ce bureau."; return; }
    var sb = new System.Text.StringBuilder(256); GetClassNameW(h, sb, 256); Cible = sb.ToString();
    var c = p; ScreenToClient(h, ref c);
    IntPtr lp = new IntPtr((c.Y << 16) | (c.X & 0xFFFF));
    if (molette != 0) {
      // WM_MOUSEWHEEL : delta en mot haut (120 par cran, positif = vers le haut), lParam en coordonnees ECRAN.
      int crans = Math.Max(-20, Math.Min(20, molette));
      PostMessageW(h, 0x020A, new IntPtr((crans * 120) << 16), new IntPtr((y << 16) | (x & 0xFFFF))); Envoyes++;
      return;
    }
    if (!sansClic) { PostMessageW(h, WM_LBUTTONDOWN, new IntPtr(1), lp); PostMessageW(h, WM_LBUTTONUP, IntPtr.Zero, lp); Envoyes += 2; Thread.Sleep(150); }
    foreach (char ch in texte ?? "") { PostMessageW(h, WM_CHAR, new IntPtr(ch), new IntPtr(1)); Envoyes++; }
    if (!string.IsNullOrEmpty(touche)) {
      int[] k;
      if (!Touches.TryGetValue(touche, out k)) { Error = "Touche inconnue : " + touche + "."; return; }
      // Touche a code virtuel : KEYDOWN/KEYUP SEULS. La boucle de messages de la cible (TranslateMessage)
      // fabrique elle-meme le WM_CHAR : en poster un en plus DOUBLAIT l'effet (mesure 2026-10-01, Audit/hact-conv35 :
      // un Retour effacait 2 caracteres). Combinaison Ctrl : caractere de controle seul.
      if (k[0] != 0) {
        PostMessageW(h, WM_KEYDOWN, new IntPtr(k[0]), new IntPtr(1));
        PostMessageW(h, WM_KEYUP, new IntPtr(k[0]), new IntPtr(unchecked((int)0xC0000001)));
        Envoyes += 2;
      } else {
        PostMessageW(h, WM_CHAR, new IntPtr(k[1]), new IntPtr(1)); Envoyes++;
        // Ctrl+A : un champ Windows d'une ligne ignore le caractere 1 (mesure) -> EM_SETSEL(0,-1), sans effet hors champ texte.
        if (k[1] == 1) { PostMessageW(h, 0x00B1, IntPtr.Zero, new IntPtr(-1)); Envoyes++; }
      }
    }
    // Meme correction pour Entree : le WM_CHAR 13 poste en plus etait recu en double.
    if (entree) { PostMessageW(h, WM_KEYDOWN, new IntPtr(0x0D), new IntPtr(1)); PostMessageW(h, WM_KEYUP, new IntPtr(0x0D), new IntPtr(unchecked((int)0xC0000001))); Envoyes += 2; }
  }
}
