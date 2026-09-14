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

  Barre des taches (champ barreDesTachesMs) : un abonnement aux evenements d'affichage des fenetres
  (SetWinEventHook, EVENT_OBJECT_SHOW) applique WS_EX_TOOLWINDOW des qu'une fenetre apparait.
  Mesure 2026-09-14 sur Roblox Studio, 3 lancements : 16, 0 et 0 ms (contre ~720 ms par simple
  sondage), vue 3D rendue a chaque fois. Ecarte : s'abonner des la CREATION (Qt ne montre plus la
  fenetre, capture sans fenetre), styler DANS le rappel (blocage > 9 min), demarrage cache (Studio
  bloque sur sa fenetre de chargement, visible en 0,0).
  Limites : pas de clic ni de clavier ; tourne dans la
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
  [ValidateSet('Hidden','Minimized')][string]$Demarrage = 'Minimized',
  [ValidateSet('Normal','Suspendu')][string]$Lancement = 'Normal', # Suspendu : CreateProcess(CREATE_SUSPENDED) — l'abonnement aux fenetres est pose AVANT que le processus ait pu en creer une
 # Hidden : mesure 2026-09-14, Studio reste bloque sur sa fenetre de chargement, visible en 0,0
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
  [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr h, IntPtr rc, IntPtr rgn, uint flags);
  const int GWL_EXSTYLE = -20; const long WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
  // SWP_ASYNCWINDOWPOS : la demande est POSTEE au thread de la fenetre au lieu d'etre ENVOYEE.
  // Mesure 2026-09-14 (conv-529) : en synchrone, les deplacements supplementaires (fenetres a
  // proprietaire) bloquaient la boucle pendant que Studio chargeait, et le bouton de la barre des
  // taches restait ~1 s au lieu de 0.
  const uint SWP_NOSIZE = 1, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_ASYNC = 0x4000;
  public static List<IntPtr> Tops(int pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  // Deplace + retire de la barre des taches ; rend le nombre de fenetres traitees et le 1er instant visible.
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  const long WS_EX_NOACTIVATE = 0x08000000;
  // ABONNEMENT AUX EVENEMENTS DE FENETRE (SetWinEventHook, hors contexte) : une fenetre de Studio
  // recoit WS_EX_TOOLWINDOW des sa creation ou son affichage, sans attendre le prochain passage de la
  // boucle. Mesure 2026-09-14 : par simple sondage toutes les 5 ms, une fenetre Qt 160x28 reduite
  // restait ~720 ms dans la barre des taches.
  public delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc cb, uint pid, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  static WinEventProc rappelFenetre; // garde une reference : sinon le ramasse-miettes libere le rappel
  static int evenementsTraites;
  static readonly Queue<IntPtr> fileFenetres = new Queue<IntPtr>();
  // Le rappel ne fait AUCUN appel vers la fenetre de Studio : il la met en file. Mesure 2026-09-14 :
  // appeler SetWindowLongPtr DANS le rappel a bloque la capture plus de 9 min (message synchrone
  // vers Studio pendant la livraison de l'evenement). La boucle principale applique le style.
  static void SurEvenementFenetre(IntPtr hook, uint evt, IntPtr h, int idObject, int idChild, uint thread, uint time) {
    if (idObject != 0 || idChild != 0 || h == IntPtr.Zero) return; // OBJID_WINDOW seulement
    fileFenetres.Enqueue(h);
  }
  static void TraiterFile() {
    while (fileFenetres.Count > 0) {
      var h = fileFenetres.Dequeue();
      if (GetAncestor(h, 2) != h) continue; // fenetre de premier niveau
      // DES L'EVENEMENT D'AFFICHAGE, avant que le sondage ne repasse : on pousse la fenetre hors
      // ecran. Mesure 2026-09-14 : par sondage seul (1 ms), il restait 55 ms d'exposition cumulee.
      bool aProprietaire = GetWindow(h, 4) != IntPtr.Zero;
      // Une fenetre A PROPRIETAIRE (popup, bulle, fenetre de chargement) est petite et son thread
      // repond : on la deplace SYNCHRONE, ce qui la sort de l'ecran des l'evenement. La fenetre
      // PRINCIPALE, elle, appartient au thread occupe a charger la place : en synchrone, la boucle
      // restait bloquee ~1 s et le bouton de barre des taches reapparaissait (mesure 2026-09-14).
      if (SurEcran(h))
        SetWindowPos(h, IntPtr.Zero, -30000, -30000, 0, 0,
          SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | (aProprietaire ? 0u : SWP_ASYNC));
      if (aProprietaire) continue; // le style barre des taches ne concerne que les fenetres sans proprietaire
      var ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
      long voulu = (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
      if (voulu != ex) { SetWindowLongPtr(h, GWL_EXSTYLE, new IntPtr(voulu)); evenementsTraites++; }
    }
  }
  static void PomperMessages() {
    MSG m;
    while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
  }
  // Toutes les fenetres de premier niveau du processus, VISIBLES OU NON.
  static List<IntPtr> ToutesFenetres(int pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  // Une fenetre a un bouton dans la barre des taches si elle est visible, sans proprietaire et sans
  // WS_EX_TOOLWINDOW (ou avec WS_EX_APPWINDOW).
  static bool DansBarreDesTaches(IntPtr h) {
    if (!IsWindowVisible(h)) return false;
    var ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
    if ((ex & WS_EX_APPWINDOW) != 0) return true;
    return GetWindow(h, 4) == IntPtr.Zero && (ex & WS_EX_TOOLWINDOW) == 0;
  }
  // Deplace hors ecran et retire de la barre des taches. Traite AUSSI les fenetres encore cachees :
  // mesure du 2026-09-14 (conv-529) — traitees seulement une fois visibles, elles montraient leur
  // bouton ~0,3 s. Rend le nombre de fenetres traitees et le temps d'exposition mesure.
  // LANCEMENT SUSPENDU. Start-Process rend la main APRES la creation du processus : entre les deux,
  // Windows a deja pu afficher une fenetre sur l'ecran. CREATE_SUSPENDED cree le processus fige ;
  // l'appelant pose son abonnement, puis reprend le thread principal.
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFO {
    public int cb; public string res, desktop, title; public int x, y, xs, ys, xc, yc, fill, flags;
    public short showWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int pid, tid; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static PROCESS_INFORMATION infoProcessus;
  public static int CreerSuspendu(string app, string cmd, string dir) {
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.flags = 0x00000001; si.showWindow = 7; // STARTF_USESHOWWINDOW | SW_SHOWMINNOACTIVE
    PROCESS_INFORMATION pi;
    if (!CreateProcess(app, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000004, IntPtr.Zero, dir, ref si, out pi))
      throw new Exception("CreateProcess a echoue : " + Marshal.GetLastWin32Error());
    infoProcessus = pi; return pi.pid;
  }
  public static void Reprendre() { if (infoProcessus.hThread != IntPtr.Zero) { ResumeThread(infoProcessus.hThread); CloseHandle(infoProcessus.hThread); CloseHandle(infoProcessus.hProcess); infoProcessus.hThread = IntPtr.Zero; } }

  // CE QUE L'UTILISATEUR VOIT. `barreDesTachesMs` ne compte que les boutons de la barre ; une fenetre
  // peut apparaitre en plein ecran sans y avoir de bouton. `ecranMs` compte le temps pendant lequel
  // au moins une fenetre du processus est VISIBLE, non reduite, et recoupe la zone d'ecran.
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  static bool SurEcran(IntPtr h) {
    if (!IsWindowVisible(h) || IsIconic(h)) return false;
    R r; if (!GetWindowRect(h, out r)) return false;
    if (r.Ri - r.L <= 0 || r.B - r.T <= 0) return false;
    int lv = GetSystemMetrics(76), tv = GetSystemMetrics(77), wv = GetSystemMetrics(78), hv = GetSystemMetrics(79);
    return r.Ri > lv && r.L < lv + wv && r.B > tv && r.T < tv + hv;
  }

  public static string Garder(int pid, int millis) { return Garder(pid, millis, false); }
  // reprendreApres : le processus a ete cree SUSPENDU ; on ne le laisse partir qu'une fois
  // l'abonnement aux evenements de fenetre en place, donc aucune fenetre ne peut naitre avant lui.
  public static string Garder(int pid, int millis, bool reprendreApres) {
    var vus = new HashSet<long>(); var sw = Stopwatch.StartNew(); long premier = -1; long exposeMs = 0; long dernier = 0;
    long ecranMs = 0; var surEcran = new Dictionary<string, long>();
    var exposees = new Dictionary<string, long>();
    rappelFenetre = SurEvenementFenetre; evenementsTraites = 0; fileFenetres.Clear();
    IntPtr abonnement = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, rappelFenetre, (uint)pid, 0, 0x0002); // SHOW seul (des CREATE, Qt ne montrait jamais la fenetre : capture sans fenetre, 2026-09-14)
    if (reprendreApres) Reprendre();
    try {
    while (sw.ElapsedMilliseconds < millis) {
      long maintenant = sw.ElapsedMilliseconds;
      bool expose = false; bool visible = false;
      foreach (var h in ToutesFenetres(pid)) {
        if (SurEcran(h)) {
          visible = true;
          var cle2 = new StringBuilder(64); GetClassName(h, cle2, 64);
          R rv; GetWindowRect(h, out rv);
          string k2 = cle2 + " " + (rv.Ri - rv.L) + "x" + (rv.B - rv.T) + " a " + rv.L + "," + rv.T;
          if (!surEcran.ContainsKey(k2)) surEcran[k2] = maintenant;
        }
        if (DansBarreDesTaches(h)) {
          expose = true;
          var cls = new StringBuilder(64); GetClassName(h, cls, 64);
          R re; GetWindowRect(h, out re);
          string cle = cls + " " + (re.Ri - re.L) + "x" + (re.B - re.T) + (IsIconic(h) ? " reduite" : "") + " a " + re.L + "," + re.T;
          if (!exposees.ContainsKey(cle)) exposees[cle] = maintenant;
        }
        R rr; GetWindowRect(h, out rr);
        int larg = rr.Ri - rr.L, haut = rr.B - rr.T;
        bool candidate = GetWindow(h, 4) == IntPtr.Zero && (IsWindowVisible(h) || (larg >= 400 && haut >= 300));
        if (!candidate) {
          // FENETRE A PROPRIETAIRE (popup, bulle, fenetre de chargement de Qt). Mesure du 2026-09-14
          // (conv-529) : elles etaient EXCLUES du deplacement et restaient posees en 0,0 sur l'ecran
          // de l'utilisateur — ecranMs = 32596 ms sur une session de 35 s. Elles n'ont pas de bouton
          // dans la barre des taches, donc barreDesTachesMs=16 les manquait entierement. On les
          // pousse hors ecran comme les autres, sans les activer ni les redimensionner.
          if (SurEcran(h)) SetWindowPos(h, IntPtr.Zero, -30000, -30000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNC);
          continue;
        }
        var ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
        long voulu = (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
        if (voulu != ex) SetWindowLongPtr(h, GWL_EXSTYLE, new IntPtr(voulu));
        if (vus.Contains(h.ToInt64())) {
          if (IsIconic(h) && IsWindowVisible(h)) {
            // Montree reduite apres avoir ete preparee cachee : on la restaure hors ecran, sinon
            // elle ne se dessine pas et la capture sort vide.
            var wpi = new WP(); wpi.length = Marshal.SizeOf(typeof(WP));
            GetWindowPlacement(h, ref wpi);
            int wi = Math.Max(wpi.rc.Ri - wpi.rc.L, 1280), hi = Math.Max(wpi.rc.B - wpi.rc.T, 800);
            wpi.rc.L = -30000; wpi.rc.T = -30000; wpi.rc.Ri = -30000 + wi; wpi.rc.B = -30000 + hi;
            wpi.showCmd = 4;
            SetWindowPlacement(h, ref wpi);
          } else if (rr.L > -20000) {
            SetWindowPos(h, IntPtr.Zero, -30000, -30000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNC);
          }
          continue;
        }
        if (!IsWindowVisible(h) && !IsIconic(h)) {
          // Encore cachee : on la place hors ecran sans la montrer ; Studio la montrera la-bas.
          SetWindowPos(h, IntPtr.Zero, -30000, -30000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_ASYNC);
          vus.Add(h.ToInt64());
          continue;
        }
        if (premier < 0) premier = maintenant;
        var wp = new WP(); wp.length = Marshal.SizeOf(typeof(WP));
        GetWindowPlacement(h, ref wp);
        int w = Math.Max(wp.rc.Ri - wp.rc.L, 1280), hh = Math.Max(wp.rc.B - wp.rc.T, 800);
        wp.rc.L = -30000; wp.rc.T = -30000; wp.rc.Ri = -30000 + w; wp.rc.B = -30000 + hh;
        wp.showCmd = 4; // SW_SHOWNOACTIVATE
        SetWindowPlacement(h, ref wp);
        vus.Add(h.ToInt64());
      }
      if (expose) exposeMs += (maintenant - dernier);
      if (visible) ecranMs += (maintenant - dernier);
      dernier = maintenant;
      PomperMessages(); TraiterFile();
      Thread.Sleep(1);
      PomperMessages(); TraiterFile();
    }
    var detail = new StringBuilder(); foreach (var kv in exposees) detail.Append(" [" + kv.Key + " des " + kv.Value + "ms]");
    foreach (var kv in surEcran) detail.Append(" [ECRAN " + kv.Key + " des " + kv.Value + "ms]");
    return "fenetres=" + vus.Count + " premiereApparitionMs=" + premier + " barreDesTachesMs=" + exposeMs + " ecranMs=" + ecranMs
      + " abonnement=" + (abonnement != IntPtr.Zero) + " evenementsTraites=" + evenementsTraites + detail;
    } finally { if (abonnement != IntPtr.Zero) UnhookWinEvent(abonnement); }
  }
  public static string Capturer(int pid, string outPath) {
    IntPtr best = IntPtr.Zero; int aire = 0;
    foreach (var h in Tops(pid)) { R r; GetWindowRect(h, out r); int a = (r.Ri - r.L) * (r.B - r.T); if (a > aire) { aire = a; best = h; } }
    if (best == IntPtr.Zero) return "aucune fenetre";
    R w; GetWindowRect(best, out w); int W = w.Ri - w.L, H = w.B - w.T;
    // PREMIERE LECTURE PERIMEE. Mesure du 2026-09-14 (Roblox Studio, 4 sessions x 3 captures a 1 s) :
    // la 1re capture d'une session peut sortir BLANCHE (vue 3D 1 couleur) alors que la 2e, une
    // seconde plus tard dans la MEME session, est rendue (245 couleurs). Une fenetre hors ecran n'est
    // redessinee que si on le lui demande : on force le redessin, on fait une lecture de chauffe
    // jetee, puis on attend avant la vraie capture.
    RedrawWindow(best, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0100 | 0x0080 | 0x0004); // INVALIDATE|UPDATENOW|ALLCHILDREN|ERASE
    using (var chauffe = new Bitmap(W, H))
    using (var gc = Graphics.FromImage(chauffe)) { var dcc = gc.GetHdc(); PrintWindow(best, dcc, 2); gc.ReleaseHdc(dcc); }
    Thread.Sleep(700);
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
  if ($Lancement -eq 'Suspendu') {
    $ligne = if ($Arguments) { '"' + $Executable + '" ' + $Arguments } else { '"' + $Executable + '"' }
    $pid2 = [HorsEcran]::CreerSuspendu($Executable, $ligne, (Split-Path -Parent $Executable))
    $p = Get-Process -Id $pid2
    # L'abonnement est pose par Garder ; on reprend le processus DEPUIS Garder (premier passage) :
    # ici, le thread est repris juste avant, l'abonnement suit a quelques microsecondes.
  } else {
    $p = if ($Arguments) { Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle $Demarrage -PassThru } else { Start-Process -FilePath $Executable -WindowStyle $Demarrage -PassThru }
  }
  $garde = [HorsEcran]::Garder($p.Id, $AttenteSecondes * 1000, ($Lancement -eq 'Suspendu'))
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
