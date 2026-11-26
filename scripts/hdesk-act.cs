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
  // ECHELLE : hdesk-observe capture en pixels PHYSIQUES. Sans cet appel, ce thread lisait X/Y en
  // pixels LOGIQUES : a 200 % (session Bureau a distance en portrait, kaizen conv-873 du 2026-09-27)
  // le clic vise (140,798) partait en (280,1596), hors du menu. -4 = PER_MONITOR_AWARE_V2, pour CE
  // thread seulement. Banc : scripts/hdesk-act.echelle.test.ps1.
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  const uint WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_CHAR = 0x102, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101;
  IntPtr hDesk;
  // conv-1374 (2026-10-31) : « Aucune fenetre en (x,y) » (6 echecs sur 16 en 10 jours) ne disait pas
  // ou etaient les fenetres. On les liste : titre (ou classe) et rectangle ecran (G,H)-(D,B), dans les
  // memes pixels que la capture. Appele par le thread deja attache au bureau (hDesk). Borne a 12.
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr d, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  string ListerFenetres() {
    var liste = new System.Collections.Generic.List<string>(); int total = 0;
    EnumProc cb = (w, l) => {
      if (!IsWindowVisible(w)) return true;
      RECT r; if (!GetWindowRect(w, out r) || r.R <= r.L || r.B <= r.T) return true;
      var t = new System.Text.StringBuilder(128); GetWindowTextW(w, t, 128);
      var c = new System.Text.StringBuilder(128); GetClassNameW(w, c, 128);
      total++;
      if (liste.Count < 12) liste.Add("\"" + (t.Length > 0 ? t.ToString().Replace("\"", "'") : c.ToString()) + "\" (" + r.L + "," + r.T + ")-(" + r.R + "," + r.B + ")");
      return true;
    };
    try { EnumDesktopWindows(hDesk, cb, IntPtr.Zero); } catch { }
    GC.KeepAlive(cb);
    if (liste.Count == 0) return " Aucune fenetre visible dans ce bureau (l'application est-elle lancee ?).";
    return " Fenetres visibles (" + total + ") : " + string.Join(" ; ", liste.ToArray()) + (total > liste.Count ? " ; ..." : "") + ".";
  }
  // ETAT DU BOUTON (conv-415, 2026-11-02) : WPF ignore le WM_LBUTTONDOWN poste et relit l'etat reel par
  // GetKeyState(VK_LBUTTON) (Win32MouseDevice.GetButtonStateFromSystem) ; un message poste ne le change
  // pas, donc une tuile de l'application metier restait « relachee ». On partage la file d'entree de la cible le temps du clic
  // (AttachThreadInput) et on y pose VK_LBUTTON enfonce pour le DOWN, relache pour le UP.
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] static extern bool GetKeyboardState(byte[] s);
  [DllImport("user32.dll")] static extern bool SetKeyboardState(byte[] s);
  [DllImport("user32.dll")] static extern bool PeekMessageW(out MSG m, IntPtr h, uint a, uint b, uint r);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr H; public uint M; public IntPtr W, L; public uint T; public POINT P; }
  static void BoutonGauche(bool enfonce) { var k = new byte[256]; if (GetKeyboardState(k)) { k[0x01] = (byte)(enfonce ? 0x80 : 0); SetKeyboardState(k); } }
  // Attend que la cible ait traite ce qui est poste avant : deux allers-retours WM_NULL (SMTO_ABORTIFHUNG, 2 s).
  static void Synchro(IntPtr h) { IntPtr r; for (int i = 0; i < 2; i++) { SendMessageTimeoutW(h, 0, IntPtr.Zero, IntPtr.Zero, 2, 2000, out r); Thread.Sleep(30); } }
  void Cliquer(IntPtr h, IntPtr lp) {
    MSG m; PeekMessageW(out m, IntPtr.Zero, 0, 0, 0); // cree la file de messages de ce thread, requise par AttachThreadInput
    uint pid, moi = GetCurrentThreadId(), cible = GetWindowThreadProcessId(h, out pid);
    bool lie = cible != 0 && cible != moi && AttachThreadInput(moi, cible, true);
    try {
      if (lie) BoutonGauche(true);
      PostMessageW(h, WM_LBUTTONDOWN, new IntPtr(1), lp); Synchro(h);
      if (lie) BoutonGauche(false);
      PostMessageW(h, WM_LBUTTONUP, IntPtr.Zero, lp); Synchro(h);
    } finally {
      if (lie) { BoutonGauche(false); AttachThreadInput(moi, cible, false); }
    }
    Envoyes += 2;
  }
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
  // FRAPPE SANS POINT : « appuie, puis tape avec -SansClic » ne donne pas de x/y. La touche va alors
  // la ou va le clavier : le controle qui a le focus dans le fil de la fenetre du dessus du bureau
  // (EnumDesktopWindows rend l'ordre Z, le dessus d'abord). Une info-bulle du meme fil en tete d'ordre
  // ne gene pas : le focus est celui du fil, pas de la fenetre. Sans focus connu : la fenetre active,
  // puis la fenetre du dessus elle-meme.
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO { public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO g);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  const int GWL_EXSTYLE = -20, WS_EX_NOACTIVATE = 0x08000000;
  // Une fenetre qui ne s'active jamais ne recoit pas le clavier. Mesure du 2026-11-26 : l'application
  // lancee cree elle-meme deux calques « UAC Input Indicator » (WS_EX_NOACTIVATE, au premier plan) ; la
  // frappe partait vers eux et le champ restait vide (banc hdesk-act.sansclic.test.ps1 rouge).
  IntPtr FenetreAuFocus() {
    IntPtr dessus = IntPtr.Zero;
    EnumProc cb = (w, l) => {
      if (!IsWindowVisible(w)) return true;
      if ((GetWindowLong(w, GWL_EXSTYLE) & WS_EX_NOACTIVATE) != 0) return true;
      RECT r; if (!GetWindowRect(w, out r) || r.R <= r.L || r.B <= r.T) return true;
      dessus = w; return false;
    };
    try { EnumDesktopWindows(hDesk, cb, IntPtr.Zero); } catch { }
    GC.KeepAlive(cb);
    if (dessus == IntPtr.Zero) return IntPtr.Zero;
    uint pid, fil = GetWindowThreadProcessId(dessus, out pid);
    var g = new GUITHREADINFO(); g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (fil != 0 && GetGUIThreadInfo(fil, ref g)) {
      if (g.hwndFocus != IntPtr.Zero) return g.hwndFocus;
      if (g.hwndActive != IntPtr.Zero) return g.hwndActive;
    }
    return dessus;
  }
  public static AutowinHdeskAct Run(string bureau, int x, int y, string texte, bool entree) { return Run(bureau, x, y, texte, entree, "", 0, "", false); }
  // `touches` : codes de touche virtuels en hexadecimal, separes par des virgules, chacun suivi de
  // xN pour le repeter (« 28x15,0D » = 15 fois Fleche bas puis Entree). C'est la seule voie qui ACTIVE
  // une entree de menu Qt (Roblox Studio, mesure du 2026-09-27). `touche` : touche NOMMEE (conv-35).
  public static AutowinHdeskAct Run(string bureau, int x, int y, string texte, bool entree, string touche, int molette, string touches, bool sansClic) {
    var a = new AutowinHdeskAct();
    var t = new Thread(() => a.Go(bureau, x, y, texte, entree, touche, molette, touches, sansClic)); t.Start(); t.Join();
    if (a.hDesk != IntPtr.Zero) CloseDesktop(a.hDesk);
    return a;
  }
  // Touches lues AVANT tout envoi. Mesure du 2026-11-26 : lues en route, une touche mal ecrite etait
  // refusee APRES le clic deja poste, et l'agent lisait « refuse » pour un geste qui avait porte.
  static string LireTouches(string touches, string touche, System.Collections.Generic.List<int[]> lues) {
    foreach (var morceau in (touches ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)) {
      var part = morceau.Trim().Split('x');
      int vk; if (!int.TryParse(part[0], System.Globalization.NumberStyles.HexNumber, null, out vk)) return "Touche illisible : '" + morceau + "' (attendu : code hexadecimal, ex. 28x15,0D).";
      int n = 1; if (part.Length > 2 || (part.Length == 2 && (!int.TryParse(part[1], out n) || n < 1))) return "Repetition illisible : '" + morceau + "' (attendu : code puis xN, N >= 1, ex. 28x15).";
      lues.Add(new[] { vk, n });
    }
    if (!string.IsNullOrEmpty(touche) && !Touches.ContainsKey(touche)) return "Touche inconnue : " + touche + ".";
    return null;
  }
  void Go(string bureau, int x, int y, string texte, bool entree, string touche, int molette, string touches, bool sansClic) {
    var lues = new System.Collections.Generic.List<int[]>();
    Error = LireTouches(touches, touche, lues);
    if (Error != null) return;
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    hDesk = OpenDesktopW(bureau, 0, false, 0x10000000);
    if (hDesk == IntPtr.Zero) { Error = "Bureau '" + bureau + "' introuvable (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    if (!SetThreadDesktop(hDesk)) { Error = "SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
    var p = new POINT { X = x, Y = y };
    bool sansPoint = x < 0 || y < 0;
    if (sansPoint && (!sansClic || molette != 0)) { Error = "Sans point, seule une frappe -SansClic part (vers le focus) : un clic ou la molette vise -X/-Y."; return; }
    IntPtr h = sansPoint ? FenetreAuFocus() : WindowFromPoint(p);
    if (h == IntPtr.Zero) {
      Error = (sansPoint ? "Aucune fenetre visible pour recevoir la frappe dans ce bureau." : "Aucune fenetre en (" + x + "," + y + ") dans ce bureau.") + ListerFenetres();
      return;
    }
    var sb = new System.Text.StringBuilder(256); GetClassNameW(h, sb, 256); Cible = sb.ToString();
    var c = p; if (!sansPoint) ScreenToClient(h, ref c);
    IntPtr lp = new IntPtr((c.Y << 16) | (c.X & 0xFFFF));
    if (molette != 0) {
      // WM_MOUSEWHEEL : delta en mot haut (120 par cran, positif = vers le haut), lParam en coordonnees ECRAN.
      int crans = Math.Max(-20, Math.Min(20, molette));
      PostMessageW(h, 0x020A, new IntPtr((crans * 120) << 16), new IntPtr((y << 16) | (x & 0xFFFF))); Envoyes++;
      return;
    }
    if (!sansClic) {
      Cliquer(h, lp);
      Thread.Sleep(150);
    }
    foreach (var vkn in lues) {
      for (int k = 0; k < vkn[1]; k++) {
        PostMessageW(h, WM_KEYDOWN, new IntPtr(vkn[0]), new IntPtr(1)); Thread.Sleep(40);
        PostMessageW(h, WM_KEYUP, new IntPtr(vkn[0]), new IntPtr(unchecked((int)0xC0000001))); Thread.Sleep(60);
        Envoyes += 2;
      }
    }
    foreach (char ch in texte ?? "") { PostMessageW(h, WM_CHAR, new IntPtr(ch), new IntPtr(1)); Envoyes++; }
    if (!string.IsNullOrEmpty(touche)) {
      int[] k = Touches[touche];
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
