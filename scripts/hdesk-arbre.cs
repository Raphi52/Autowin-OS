// ARBRE D'ACCESSIBILITE D'UN BUREAU CACHE (conv-1457, idee reprise de l'outil « computer » d'omp).
//
// Pourquoi : dans un bureau cache, un agent ne visait que des pixels. Il lisait mal une capture unie,
// visait faux une capture recadree, et ses clics restaient sans effet sur une fenetre WPF non agrandie
// (mesure du 2026-11-03 : case WPF restee « Off » apres deux clics postes au centre, alors que
// TogglePattern.Toggle la passe a « On » et InvokePattern.Invoke declenche le bouton).
//
// Charge par scripts/hdesk-arbre.ps1 (lecture) et scripts/hdesk-act.ps1 -Element (appui), lus en UTF-8.
// Messages en ASCII, comme hdesk-act.cs : le texte part sur stderr vers Node.
//
// Mesures qui fondent les choix (bureau AutowinTest_run-run-b37170445c5e-1, 2026-11-03) :
//  - UI Automation ne voit l'arbre d'un bureau cache que depuis un thread STA qui a fait OpenDesktopW +
//    SetThreadDesktop AVANT tout appel UIA ; Table des caracteres : 340 elements en ~64 ms.
//  - Les rectangles sont en pixels de l'ecran du bureau, ceux de hdesk-act -X/-Y, a condition de prendre
//    le meme contexte DPI que hdesk-act.cs (SetThreadDpiAwarenessContext(-4)).
//  - Un bouton WPF dont l'etiquette est dans un panneau a un Name VIDE : son libelle est le premier
//    element Text de son sous-arbre.
//  - Appui selon la technologie (FrameworkId) : WPF -> motif d'accessibilite (Invoke, Toggle, Select,
//    Expand/Collapse) ; autre (Win32...) -> clic au centre par hdesk-act (Toggle a echoue sur une case Win32,
//    et InvokePattern.Invoke sur le bouton Win32 103 de la Table des caracteres leve
//    InvalidOperationException dans un bureau cache, mesure du 2026-11-08).
//  - ValuePattern.SetValue remplit le champ Win32 104 de la Table des caracteres dans un bureau cache, et
//    un element se retrouve par son RuntimeId (PropertyCondition) : mesures du 2026-11-08.
//
// REPERES LIES A UNE LECTURE (2026-11-08, repris de vercel-labs/agent-desktop) : viser par NOM approche
// pouvait appuyer sur un AUTRE element quand l'ecran avait change entre la lecture et le geste. Chaque
// lecture recoit un identifiant, chaque element un repere « @<lecture>:e<n> », et la lecture est gardee
// sur disque (<registre>/<bureau>.lectures.txt, les LECTURES_GARDEES dernieres). Un appui par repere
// retrouve l'element VIVANT par son RuntimeId et refuse (code PERIME) s'il a disparu ou change de nom.
// fix-ok: 3 édits mesurés sur une fenêtre WPF réelle (2026-11-03) : le refus « Doublon » citait aussi les 2 étiquettes Text, et « Valider tout » ne citait pas « Valider la saisie » (distance 9 > seuil 7).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

public class AutowinHdeskArbre {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n, uint f, bool i, uint a);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr d, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);

  /** Longueur gardee d'un nom, d'un libelle ou d'une valeur. */
  const int TEXTE_MAX = 200;
  /** Candidats cites dans un refus « plusieurs elements » ; plus proches cites dans « introuvable ». */
  const int CANDIDATS_MAX = 10;
  const int PROCHES_MAX = 5;
  /** Lectures gardees par bureau : un repere d'une lecture plus ancienne est refuse (PERIME). */
  const int LECTURES_GARDEES = 5;
  /** Ecart toleré (pixels) pour reconnaitre un element dont le fournisseur change de RuntimeId. */
  const int ECART_MAX = 4;
  /** Titres de fenetres, et lignes de changements, rendus dans l'etat apres geste. */
  const int TITRES_MAX = 8;
  const int CHANGEMENTS_MAX = 10;

  public class Element {
    public int Fenetre;
    public long Hwnd;
    public string Type = "", Nom = "", Id = "", Libelle = "", Techno = "", Valeur = null, Coche = null, Rid = "", Ref = "";
    public bool Actif, HorsEcran, AvecRect, Invoke, Toggle, Selection, Deplier, AValeur, Defiler, MotDePasse;
    public int X, Y, L, H;
    public AutomationElement Ae;
    public string Montre() { return Nom != "" ? Nom : (Libelle != "" ? Libelle : Id); }
  }

  /**
   * Resultat d'un appui. Code (refus) : INVALIDE, PERIME, INTROUVABLE, AMBIGU, INACTIF, HORS_ECRAN,
   * REFUSE, SANS_ARBRE ; hdesk-act.ps1 le place en tete du message, « [PERIME] ... ».
   * Rid/Hwnd/Avant : de quoi dire, apres le geste, ce qui a change (EtatApres).
   */
  public class Resultat {
    public string Erreur, Code;
    public string Appui;
    public string Json = "";
    public int X, Y;
    public string Rid = "";
    public long Hwnd;
    public Instant Avant;
  }

  // Types qu'un agent veut appuyer : départagent une étiquette Text qui porte le même nom que son bouton.
  static readonly HashSet<string> Agissables = new HashSet<string>(new string[] {
    "Button", "CheckBox", "RadioButton", "MenuItem", "TabItem", "ListItem", "TreeItem", "Hyperlink",
    "ComboBox", "SplitButton", "Edit", "DataItem", "HeaderItem", "Spinner", "Slider"
  });

  static string Propre(string s) {
    if (s == null) return "";
    var sb = new StringBuilder(s.Length);
    foreach (char c in s) sb.Append(char.IsControl(c) ? ' ' : c);
    string t = sb.ToString().Trim();
    return t.Length > TEXTE_MAX ? t.Substring(0, TEXTE_MAX) : t;
  }

  // JSON en ASCII pur (\uXXXX) : sa lecture ne depend d'aucune page de code de console.
  static string Js(string s) {
    var sb = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"') sb.Append("\\\"");
      else if (c == '\\') sb.Append("\\\\");
      else if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4"));
      else sb.Append(c);
    }
    return sb.Append('"').ToString();
  }

  // Thread STA rattache au bureau, meme contexte DPI que hdesk-act.cs. Toute erreur remonte en message.
  static T SurLeBureau<T>(string bureau, Func<IntPtr, T> travail) {
    T res = default(T);
    string erreur = null;
    var t = new Thread(() => {
      IntPtr d = IntPtr.Zero;
      try {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        d = OpenDesktopW(bureau, 0, false, 0x10000000);
        if (d == IntPtr.Zero) { erreur = "Bureau '" + bureau + "' introuvable (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
        if (!SetThreadDesktop(d)) { erreur = "SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ")."; return; }
        res = travail(d);
      } catch (Exception e) {
        erreur = "Lecture de l'arbre impossible : " + e.GetType().Name + " : " + e.Message;
      } finally {
        if (d != IntPtr.Zero) CloseDesktop(d);
      }
    });
    t.SetApartmentState(ApartmentState.STA);
    t.Start();
    t.Join();
    if (erreur != null) throw new InvalidOperationException(erreur);
    return res;
  }

  static List<Element> Collecter(IntPtr d, List<string> titres) {
    var fenetres = new List<IntPtr>();
    EnumDesktopWindows(d, (h, l) => { if (IsWindowVisible(h)) fenetres.Add(h); return true; }, IntPtr.Zero);
    var cr = new CacheRequest();
    cr.Add(AutomationElement.NameProperty);
    cr.Add(AutomationElement.AutomationIdProperty);
    cr.Add(AutomationElement.ControlTypeProperty);
    cr.Add(AutomationElement.FrameworkIdProperty);
    cr.Add(AutomationElement.IsEnabledProperty);
    cr.Add(AutomationElement.IsOffscreenProperty);
    cr.Add(AutomationElement.IsPasswordProperty);
    cr.Add(AutomationElement.BoundingRectangleProperty);
    cr.Add(AutomationElement.RuntimeIdProperty);
    cr.Add(AutomationElement.IsInvokePatternAvailableProperty);
    cr.Add(AutomationElement.IsTogglePatternAvailableProperty);
    cr.Add(AutomationElement.IsSelectionItemPatternAvailableProperty);
    cr.Add(AutomationElement.IsExpandCollapsePatternAvailableProperty);
    cr.Add(AutomationElement.IsValuePatternAvailableProperty);
    cr.Add(AutomationElement.IsScrollItemPatternAvailableProperty);
    cr.AutomationElementMode = AutomationElementMode.Full;
    var res = new List<Element>();
    foreach (var h in fenetres) {
      AutomationElementCollection tous;
      string titre = "";
      try {
        var racine = AutomationElement.FromHandle(h);
        try { titre = Propre(racine.Current.Name); } catch { }
        using (cr.Activate()) { tous = racine.FindAll(TreeScope.Descendants, Condition.TrueCondition); }
      } catch {
        // Fenetre fermee entre l'enumeration et la lecture, ou arbre refuse par l'app : on lit les
        // autres. Si AUCUNE ne se lit, l'appelant le dit (« aucun element lisible ») et l'image reste.
        continue;
      }
      // Fenetres techniques du bureau (aucun descendant) : sans interet pour l'agent.
      if (tous.Count == 0) continue;
      int f = titres.Count;
      titres.Add(titre);
      foreach (AutomationElement e in tous) {
        var el = Decrire(e, f);
        if (el == null) continue;
        el.Hwnd = h.ToInt64();
        res.Add(el);
      }
    }
    return res;
  }

  static bool Vrai(AutomationElement e, AutomationProperty p) {
    object v = e.GetCachedPropertyValue(p);
    return v is bool && (bool)v;
  }

  static string RidTexte(int[] rid) {
    if (rid == null || rid.Length == 0) return "";
    var parts = new string[rid.Length];
    for (int i = 0; i < rid.Length; i++) parts[i] = rid[i].ToString(CultureInfo.InvariantCulture);
    return string.Join(".", parts);
  }

  static Element Decrire(AutomationElement e, int f) {
    var el = new Element();
    el.Fenetre = f;
    el.Ae = e;
    try {
      el.Nom = Propre(e.Cached.Name);
      el.Id = Propre(e.Cached.AutomationId);
      var ct = e.Cached.ControlType;
      el.Type = ct == null ? "" : ct.ProgrammaticName.Replace("ControlType.", "");
      el.Techno = Propre(e.Cached.FrameworkId);
      el.Actif = e.Cached.IsEnabled;
      el.HorsEcran = e.Cached.IsOffscreen;
      el.MotDePasse = e.Cached.IsPassword;
      var r = e.Cached.BoundingRectangle;
      if (!r.IsEmpty && !double.IsInfinity(r.Width) && !double.IsNaN(r.Width) && r.Width > 0 && r.Height > 0) {
        el.AvecRect = true;
        el.X = (int)Math.Round(r.X); el.Y = (int)Math.Round(r.Y);
        el.L = (int)Math.Round(r.Width); el.H = (int)Math.Round(r.Height);
      }
      try { el.Rid = RidTexte(e.GetCachedPropertyValue(AutomationElement.RuntimeIdProperty) as int[]); } catch { }
      el.Invoke = Vrai(e, AutomationElement.IsInvokePatternAvailableProperty);
      el.Toggle = Vrai(e, AutomationElement.IsTogglePatternAvailableProperty);
      el.Selection = Vrai(e, AutomationElement.IsSelectionItemPatternAvailableProperty);
      el.Deplier = Vrai(e, AutomationElement.IsExpandCollapsePatternAvailableProperty);
      el.Defiler = Vrai(e, AutomationElement.IsScrollItemPatternAvailableProperty);
      el.AValeur = Vrai(e, AutomationElement.IsValuePatternAvailableProperty);
      if (el.AValeur && !el.MotDePasse) {
        // Jamais la valeur d'un champ mot de passe (IsPassword) : elle partirait dans le contexte du modele.
        try { el.Valeur = Propre(((ValuePattern)e.GetCurrentPattern(ValuePattern.Pattern)).Current.Value); } catch { }
      }
      if (el.Toggle) {
        try { el.Coche = ((TogglePattern)e.GetCurrentPattern(TogglePattern.Pattern)).Current.ToggleState.ToString(); } catch { }
      }
    } catch { return null; }
    if (el.Nom == "" && Agissables.Contains(el.Type)) {
      try {
        var texte = e.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text));
        if (texte != null) el.Libelle = Propre(texte.Current.Name);
      } catch { }
    }
    // Un element sans nom, sans identifiant ni libelle ne peut etre ni lu ni vise : on le tait.
    if (el.Nom == "" && el.Id == "" && el.Libelle == "") return null;
    return el;
  }

  static string JsonElement(Element el, int ox, int oy) {
    var sb = new StringBuilder("{");
    if (el.Ref != "") sb.Append("\"ref\":").Append(Js(el.Ref)).Append(',');
    sb.Append("\"type\":").Append(Js(el.Type));
    if (el.Nom != "") sb.Append(",\"nom\":").Append(Js(el.Nom));
    if (el.Id != "") sb.Append(",\"id\":").Append(Js(el.Id));
    if (el.Libelle != "") sb.Append(",\"libelle\":").Append(Js(el.Libelle));
    if (el.Techno != "") sb.Append(",\"techno\":").Append(Js(el.Techno));
    sb.Append(",\"actif\":").Append(el.Actif ? "true" : "false");
    if (el.AvecRect) {
      sb.Append(",\"x\":").Append(el.X - ox).Append(",\"y\":").Append(el.Y - oy);
      sb.Append(",\"largeur\":").Append(el.L).Append(",\"hauteur\":").Append(el.H);
    }
    if (el.HorsEcran) sb.Append(",\"horsEcran\":true");
    if (el.Coche != null) sb.Append(",\"coche\":").Append(Js(el.Coche));
    if (el.Valeur != null) sb.Append(",\"valeur\":").Append(Js(el.Valeur));
    if (el.AValeur && !el.MotDePasse) sb.Append(",\"modifiable\":true");
    sb.Append(",\"fenetre\":").Append(el.Fenetre);
    return sb.Append('}').ToString();
  }

  // Une ligne lisible pour un refus ; position = CENTRE, en pixels de l'image si l'origine est passee.
  static string Decrit(Element el, int ox, int oy) {
    var sb = new StringBuilder("- ").Append(el.Type).Append(" '").Append(el.Montre()).Append("'");
    if (el.Ref != "") sb.Append(" ").Append(el.Ref);
    if (el.Id != "" && el.Id != el.Montre()) sb.Append(" id=").Append(el.Id);
    if (el.AvecRect) sb.Append(" centre (").Append(el.X + el.L / 2 - ox).Append(",").Append(el.Y + el.H / 2 - oy).Append(")");
    if (!el.Actif) sb.Append(" [inactif]");
    return sb.ToString();
  }

  // ---- Lectures gardees sur disque -------------------------------------------------------------
  // Format texte, une lecture par bloc :
  //   L <tab> <lecture> <tab> <ticks UTC>
  //   E <tab> <n> <tab> <rid> <tab> <hwnd> <tab> <type> <tab> x <tab> y <tab> l <tab> h <tab> b64(nom) <tab> b64(id) <tab> b64(libelle)
  // Jamais de valeur de champ : seulement de quoi reconnaitre l'element. Efface avec le bureau
  // (purgerBureauxFermes, src/main/bureau/hdesk-tv.ts).

  class Gardee { public string Id; public List<string[]> Lignes = new List<string[]>(); }

  static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s ?? "")); }
  static string DeB64(string s) { try { return Encoding.UTF8.GetString(Convert.FromBase64String(s)); } catch { return ""; } }

  static List<Gardee> LireLectures(string fichier) {
    var res = new List<Gardee>();
    if (string.IsNullOrEmpty(fichier)) return res;
    try {
      if (!File.Exists(fichier)) return res;
      Gardee cur = null;
      foreach (var ligne in File.ReadAllLines(fichier, Encoding.UTF8)) {
        var p = ligne.Split('\t');
        if (p[0] == "L" && p.Length >= 2) { cur = new Gardee { Id = p[1] }; res.Add(cur); }
        else if (p[0] == "E" && cur != null && p.Length >= 12) cur.Lignes.Add(p);
      }
    } catch { res.Clear(); }
    return res;
  }

  static void GarderLecture(string fichier, string lecture, List<Element> els, int n) {
    if (string.IsNullOrEmpty(fichier)) return;
    var anciennes = LireLectures(fichier);
    var sb = new StringBuilder();
    for (int i = Math.Max(0, anciennes.Count - (LECTURES_GARDEES - 1)); i < anciennes.Count; i++) {
      sb.Append("L\t").Append(anciennes[i].Id).Append('\n');
      foreach (var p in anciennes[i].Lignes) sb.Append(string.Join("\t", p)).Append('\n');
    }
    sb.Append("L\t").Append(lecture).Append('\t').Append(DateTime.UtcNow.Ticks).Append('\n');
    for (int i = 0; i < n; i++) {
      var e = els[i];
      sb.Append("E\t").Append(i + 1).Append('\t').Append(e.Rid).Append('\t').Append(e.Hwnd).Append('\t').Append(e.Type)
        .Append('\t').Append(e.X).Append('\t').Append(e.Y).Append('\t').Append(e.L).Append('\t').Append(e.H)
        .Append('\t').Append(B64(e.Nom)).Append('\t').Append(B64(e.Id)).Append('\t').Append(B64(e.Libelle)).Append('\n');
    }
    // Ecriture complete puis remplacement : un geste qui lit au meme instant voit l'ancienne ou la
    // nouvelle version, jamais un fichier tronque.
    string tmp = fichier + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
    try {
      var dossier = Path.GetDirectoryName(fichier);
      if (!string.IsNullOrEmpty(dossier)) Directory.CreateDirectory(dossier);
      File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
      if (File.Exists(fichier)) File.Replace(tmp, fichier, null); else File.Move(tmp, fichier);
    } catch {
      try { File.Delete(tmp); } catch { }
      // Lecture non gardee : ses reperes seront refuses (PERIME) et l'agent relira. L'arbre reste rendu.
    }
  }

  static string NouvelleLecture() {
    const string a = "abcdefghijklmnopqrstuvwxyz0123456789";
    var b = Guid.NewGuid().ToByteArray();
    var sb = new StringBuilder();
    for (int i = 0; i < 6; i++) sb.Append(a[b[i] % 36]);
    return sb.ToString();
  }

  /**
   * Lecture : JSON {bureau, lecture, fenetres, total, omis, elements[]} en pixels de l'ecran du bureau.
   * `fichier` : ou garder la lecture pour les appuis par repere ; vide = reperes non rendus.
   */
  public static string Lire(string bureau, int plafond, string fichier) {
    return SurLeBureau(bureau, d => {
      var titres = new List<string>();
      var els = Collecter(d, titres);
      int n = Math.Min(els.Count, Math.Max(0, plafond));
      string lecture = string.IsNullOrEmpty(fichier) ? "" : NouvelleLecture();
      if (lecture != "") {
        for (int i = 0; i < n; i++) els[i].Ref = "@" + lecture + ":e" + (i + 1);
        GarderLecture(fichier, lecture, els, n);
      }
      var sb = new StringBuilder("{\"bureau\":").Append(Js(bureau));
      if (lecture != "") sb.Append(",\"lecture\":").Append(Js(lecture));
      sb.Append(",\"fenetres\":[");
      for (int i = 0; i < titres.Count; i++) sb.Append(i > 0 ? "," : "").Append(Js(titres[i]));
      sb.Append("],\"total\":").Append(els.Count).Append(",\"omis\":").Append(els.Count - n).Append(",\"elements\":[");
      for (int i = 0; i < n; i++) sb.Append(i > 0 ? "," : "").Append(JsonElement(els[i], 0, 0));
      return sb.Append("]}").ToString();
    });
  }

  /** Compatibilite : lecture sans repere. */
  public static string Lire(string bureau, int plafond) { return Lire(bureau, plafond, ""); }

  static List<Element> Filtrer(List<Element> els, Func<Element, bool> garde) {
    var r = new List<Element>();
    foreach (var e in els) if (garde(e)) r.Add(e);
    return r;
  }

  // Plusieurs correspondances : si UNE seule est d'un type agissable, c'est elle (le bouton plutot que
  // son etiquette Text qui porte le meme nom). Sinon : ambigu (null).
  static Element Departager(List<Element> t) {
    if (t.Count == 1) return t[0];
    Element seul = null;
    foreach (var e in t) {
      if (!Agissables.Contains(e.Type)) continue;
      if (seul != null) return null;
      seul = e;
    }
    return seul;
  }

  static int Distance(string a, string b) {
    if (a.Length > 60) a = a.Substring(0, 60);
    if (b.Length > 60) b = b.Substring(0, 60);
    var p = new int[b.Length + 1];
    var c = new int[b.Length + 1];
    for (int j = 0; j <= b.Length; j++) p[j] = j;
    for (int i = 1; i <= a.Length; i++) {
      c[0] = i;
      for (int j = 1; j <= b.Length; j++)
        c[j] = Math.Min(Math.Min(c[j - 1] + 1, p[j] + 1), p[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
      var x = p; p = c; c = x;
    }
    return p[b.Length];
  }

  static string Introuvable(List<Element> els, string cible, int ox, int oy) {
    string bas = cible.ToLowerInvariant();
    int seuil = Math.Max(3, cible.Length * 6 / 10);
    // Proche = peu de lettres a changer, OU un mot de 4 lettres au moins en commun (« Valider tout »
    // -> « Valider la saisie » : 9 lettres a changer, mais le meme verbe).
    var mots = new List<string>();
    foreach (var m in bas.Split(new char[] { ' ', '\t', ':', '-', '_', '.', '\'' }, StringSplitOptions.RemoveEmptyEntries))
      if (m.Length >= 4) mots.Add(m);
    var vus = new HashSet<string>();
    var proches = new List<KeyValuePair<int, Element>>();
    foreach (var e in els) {
      string m = e.Montre();
      if (m == "" || !vus.Add(m)) continue;
      string mb = m.ToLowerInvariant();
      int d = Math.Min(Distance(bas, mb), e.Id == "" ? int.MaxValue : Distance(bas, e.Id.ToLowerInvariant()));
      bool motCommun = false;
      foreach (var mot in mots) if (mb.Contains(mot)) { motCommun = true; break; }
      if (d <= seuil || motCommun) proches.Add(new KeyValuePair<int, Element>(d, e));
    }
    proches.Sort((a, b) => a.Key.CompareTo(b.Key));
    var sb = new StringBuilder("Aucun element '").Append(cible).Append("' dans ce bureau");
    if (proches.Count == 0)
      return sb.Append(", ni aucun element proche. Lis l'arbre (bureau_cache_observer) pour voir les noms disponibles.").ToString();
    sb.Append(". Les plus proches :");
    for (int i = 0; i < proches.Count && i < PROCHES_MAX; i++) sb.Append("\n").Append(Decrit(proches[i].Value, ox, oy));
    return sb.ToString();
  }

  static string Ambigu(List<Element> tous, string cible, int ox, int oy) {
    // Mesure WPF du 2026-11-03 : chaque bouton « Doublon » a aussi son etiquette Text du meme nom ; on ne
    // cite que les elements agissables quand il y en a au moins deux.
    var agissables = Filtrer(tous, e => Agissables.Contains(e.Type));
    var t = agissables.Count >= 2 ? agissables : tous;
    var sb = new StringBuilder("Plusieurs elements '").Append(cible).Append("' (").Append(t.Count)
      .Append(") : vise le repere (@...) de l'un d'eux, son identifiant (id), ou x/y sur l'image.");
    for (int i = 0; i < t.Count && i < CANDIDATS_MAX; i++) sb.Append("\n").Append(Decrit(t[i], ox, oy));
    if (t.Count > CANDIDATS_MAX) sb.Append("\n... et ").Append(t.Count - CANDIDATS_MAX).Append(" autres.");
    return sb.ToString();
  }

  // Reperes de la DERNIERE lecture gardee, poses sur les elements vivants qu'elle a vus (par RuntimeId) :
  // un refus par nom peut alors citer le repere de chaque candidat.
  static void PoserReperes(List<Element> els, string fichier) {
    var lectures = LireLectures(fichier);
    if (lectures.Count == 0) return;
    var g = lectures[lectures.Count - 1];
    var parRid = new Dictionary<string, string>();
    foreach (var p in g.Lignes) if (p[2] != "" && !parRid.ContainsKey(p[2] + "|" + p[3])) parRid[p[2] + "|" + p[3]] = "@" + g.Id + ":e" + p[1];
    foreach (var e in els) {
      string r;
      if (e.Rid != "" && parRid.TryGetValue(e.Rid + "|" + e.Hwnd, out r)) e.Ref = r;
    }
  }

  static readonly Regex Repere = new Regex("^@([a-z0-9]{4,16}):e([0-9]{1,5})$");

  // Repere -> element VIVANT, ou refus (code + message). Meme element = meme RuntimeId dans la meme
  // fenetre, meme type et meme nom ; a defaut de RuntimeId stable, un seul element de memes type, nom,
  // identifiant et libelle, a moins de ECART_MAX pixels de sa position lue.
  static Element ParRepere(List<Element> els, string cible, string fichier, Resultat r, int ox, int oy) {
    var m = Repere.Match(cible);
    if (!m.Success) {
      r.Code = "INVALIDE";
      r.Erreur = "Repere illisible '" + cible + "' : attendu @<lecture>:e<n>, tel que rendu par l'arbre (ex. @k3f9a2:e8). Un repere sans sa lecture (@e8) est refuse.";
      return null;
    }
    string lecture = m.Groups[1].Value, n = m.Groups[2].Value;
    Gardee g = null;
    foreach (var x in LireLectures(fichier)) if (x.Id == lecture) g = x;
    if (g == null) {
      r.Code = "PERIME";
      r.Erreur = "Repere " + cible + " : lecture '" + lecture + "' inconnue ou trop ancienne (les " + LECTURES_GARDEES + " dernieres lectures de ce bureau sont gardees).";
      return null;
    }
    string[] p = null;
    foreach (var x in g.Lignes) if (x[1] == n) p = x;
    if (p == null) {
      r.Code = "INVALIDE";
      r.Erreur = "La lecture '" + lecture + "' n'a pas d'element e" + n + ".";
      return null;
    }
    string rid = p[2], type = p[4], nom = DeB64(p[9]), id = DeB64(p[10]), libelle = DeB64(p[11]);
    long hwnd; long.TryParse(p[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out hwnd);
    int lx, ly; int.TryParse(p[5], out lx); int.TryParse(p[6], out ly);
    string vu = type + " '" + (nom != "" ? nom : (libelle != "" ? libelle : id)) + "'";
    Element el = null;
    if (rid != "") foreach (var e in els) if (e.Rid == rid && e.Hwnd == hwnd) { el = e; break; }
    if (el != null) {
      if (el.Type != type || el.Nom != nom || el.Id != id || el.Libelle != libelle) {
        r.Code = "PERIME";
        r.Erreur = "L'element " + cible + " a change depuis la lecture : " + vu + " est devenu :\n" + Decrit(el, ox, oy);
        return null;
      }
      el.Ref = cible;
      return el;
    }
    var memes = Filtrer(els, e => e.Hwnd == hwnd && e.Type == type && e.Nom == nom && e.Id == id && e.Libelle == libelle
      && Math.Abs(e.X - lx) <= ECART_MAX && Math.Abs(e.Y - ly) <= ECART_MAX);
    if (memes.Count == 1) { memes[0].Ref = cible; return memes[0]; }
    r.Code = "PERIME";
    r.Erreur = "L'element " + cible + " (" + vu + ") n'est plus a l'ecran : fenetre fermee ou contenu change depuis la lecture.";
    return null;
  }

  // ---- Ce que le geste a change --------------------------------------------------------------------
  // Mesure qui fonde le choix (2026-11-08) : le bouton « Selectionner » (103) de la Table des caracteres
  // ne change pas lui-meme, il remplit le champ 104. Surveiller le seul element appuye aurait conclu
  // « rien n'a change » : on surveille toute la fenetre de l'element, et les fenetres du bureau.

  public class Etat { public string Type = "", Nom = "", Id = "", Coche, Valeur, Deplie, Selection; public bool Actif; }

  /** Etat d'avant le geste : la fenetre de l'element (element par element) et les fenetres du bureau. */
  public class Instant {
    public string Rid = "";
    public Dictionary<string, Etat> Elements = new Dictionary<string, Etat>();
    public Dictionary<long, string> Fenetres = new Dictionary<long, string>();
  }

  static Dictionary<long, string> Fenetres(IntPtr d) {
    var t = new Dictionary<long, string>();
    EnumDesktopWindows(d, (h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      if (GetWindowTextW(h, sb, 256) > 0) t[h.ToInt64()] = Propre(sb.ToString());
      return true;
    }, IntPtr.Zero);
    return t;
  }

  static string EnCache(AutomationElement e, AutomationProperty p) {
    object v;
    try { v = e.GetCachedPropertyValue(p, true); } catch { return null; }
    if (v == null || v == AutomationElement.NotSupported) return null;
    return v.ToString();
  }

  static Instant Instantane(IntPtr d, long hwnd, string rid) {
    var s = new Instant { Rid = rid ?? "", Fenetres = Fenetres(d) };
    var h = new IntPtr(hwnd);
    if (hwnd == 0 || !IsWindow(h)) return s;
    var cr = new CacheRequest();
    cr.Add(AutomationElement.NameProperty);
    cr.Add(AutomationElement.AutomationIdProperty);
    cr.Add(AutomationElement.ControlTypeProperty);
    cr.Add(AutomationElement.IsEnabledProperty);
    cr.Add(AutomationElement.IsPasswordProperty);
    cr.Add(AutomationElement.RuntimeIdProperty);
    cr.Add(TogglePattern.ToggleStateProperty);
    cr.Add(ValuePattern.ValueProperty);
    cr.Add(ExpandCollapsePattern.ExpandCollapseStateProperty);
    cr.Add(SelectionItemPattern.IsSelectedProperty);
    cr.AutomationElementMode = AutomationElementMode.None;
    AutomationElementCollection tous;
    try {
      var racine = AutomationElement.FromHandle(h);
      using (cr.Activate()) { tous = racine.FindAll(TreeScope.Subtree, Condition.TrueCondition); }
    } catch { return s; }
    int i = 0;
    foreach (AutomationElement e in tous) {
      i++;
      var x = new Etat();
      try {
        x.Nom = Propre(EnCache(e, AutomationElement.NameProperty));
        x.Id = Propre(EnCache(e, AutomationElement.AutomationIdProperty));
        var ct = e.GetCachedPropertyValue(AutomationElement.ControlTypeProperty) as ControlType;
        x.Type = ct == null ? "" : ct.ProgrammaticName.Replace("ControlType.", "");
        x.Actif = EnCache(e, AutomationElement.IsEnabledProperty) == "True";
        x.Coche = EnCache(e, TogglePattern.ToggleStateProperty);
        if (EnCache(e, AutomationElement.IsPasswordProperty) != "True") {
          var v = EnCache(e, ValuePattern.ValueProperty);
          x.Valeur = v == null ? null : Propre(v);
        }
        x.Deplie = EnCache(e, ExpandCollapsePattern.ExpandCollapseStateProperty);
        x.Selection = EnCache(e, SelectionItemPattern.IsSelectedProperty);
      } catch { continue; }
      string cle = "";
      try { cle = RidTexte(e.GetCachedPropertyValue(AutomationElement.RuntimeIdProperty) as int[]); } catch { }
      if (cle == "") cle = x.Type + "|" + x.Nom + "|" + x.Id + "|" + i;
      s.Elements[cle] = x;
    }
    return s;
  }

  static string Court(string s) { s = s ?? ""; return s.Length > 60 ? s.Substring(0, 57) + "..." : s; }
  static string Nomme(Etat e) { return e.Type + " '" + Court(e.Nom != "" ? e.Nom : e.Id) + "'"; }

  // Changements lisibles d'un instant a l'autre. Un element sans nom ni identifiant qui apparait ou
  // disparait (cadre de focus, panneau de mise en page) ne compte pas : il ne dit rien a l'agent.
  static List<string> Differences(Instant a, Instant b) {
    var modifs = new List<string>();
    var apparus = new List<string>();
    var partis = new List<string>();
    foreach (var kv in a.Fenetres) {
      string t;
      if (!b.Fenetres.TryGetValue(kv.Key, out t)) modifs.Add("fenetre fermee : '" + Court(kv.Value) + "'");
      else if (t != kv.Value) modifs.Add("fenetre renommee : '" + Court(kv.Value) + "' -> '" + Court(t) + "'");
    }
    foreach (var kv in b.Fenetres) if (!a.Fenetres.ContainsKey(kv.Key)) modifs.Add("fenetre ouverte : '" + Court(kv.Value) + "'");
    foreach (var kv in b.Elements) {
      Etat x, y = kv.Value;
      if (!a.Elements.TryGetValue(kv.Key, out x)) { if (y.Nom != "" || y.Id != "") apparus.Add("+ " + Nomme(y) + " (apparu)"); continue; }
      var c = new List<string>();
      if (x.Nom != y.Nom) c.Add("nom -> '" + Court(y.Nom) + "'");
      if (x.Actif != y.Actif) c.Add(y.Actif ? "actif" : "inactif");
      if (x.Coche != y.Coche) c.Add("coche " + x.Coche + " -> " + y.Coche);
      if (x.Valeur != y.Valeur) c.Add("valeur '" + Court(x.Valeur) + "' -> '" + Court(y.Valeur) + "'");
      if (x.Deplie != y.Deplie) c.Add("deplie " + x.Deplie + " -> " + y.Deplie);
      if (x.Selection != y.Selection) c.Add(y.Selection == "True" ? "selectionne" : "deselectionne");
      if (c.Count > 0) modifs.Add(Nomme(x) + " : " + string.Join(", ", c.ToArray()));
    }
    foreach (var kv in a.Elements)
      if (!b.Elements.ContainsKey(kv.Key) && (kv.Value.Nom != "" || kv.Value.Id != "")) partis.Add("- " + Nomme(kv.Value) + " (disparu)");
    modifs.AddRange(apparus);
    modifs.AddRange(partis);
    return modifs;
  }

  static string JsonEtat(Instant s) {
    Etat e;
    if (s.Rid == "") return "\"inconnu\"";
    if (!s.Elements.TryGetValue(s.Rid, out e)) return "\"disparu\"";
    var sb = new StringBuilder("{\"nom\":").Append(Js(e.Nom)).Append(",\"actif\":").Append(e.Actif ? "true" : "false");
    if (e.Coche != null) sb.Append(",\"coche\":").Append(Js(e.Coche));
    if (e.Valeur != null) sb.Append(",\"valeur\":").Append(Js(e.Valeur));
    if (e.Deplie != null) sb.Append(",\"deplie\":").Append(Js(e.Deplie));
    if (e.Selection != null) sb.Append(",\"selectionne\":").Append(e.Selection == "True" ? "true" : "false");
    return sb.Append('}').ToString();
  }

  /**
   * Apres le geste : relit la fenetre de l'element et les fenetres du bureau jusqu'a un changement (puis
   * 150 ms de plus, le temps que l'ecran se pose) ou jusqu'a `delaiMs`. JSON {changement, attenteMs,
   * element (etat apres, « disparu » ou « inconnu »), changements[] (lignes lisibles), fenetres[]}.
   * `changement: false` = rien de visible dans l'arbre : le geste a peut-etre ete ignore.
   */
  public static string EtatApres(string bureau, Resultat r, int delaiMs) {
    return SurLeBureau(bureau, d => {
      var sw = Stopwatch.StartNew();
      var avant = r.Avant ?? new Instant();
      Instant b;
      List<string> diff;
      while (true) {
        b = Instantane(d, r.Hwnd, r.Rid);
        diff = Differences(avant, b);
        if (diff.Count > 0) {
          Thread.Sleep(150);
          var b2 = Instantane(d, r.Hwnd, r.Rid);
          var diff2 = Differences(avant, b2);
          if (diff2.Count > 0) { b = b2; diff = diff2; }
          break;
        }
        if (sw.ElapsedMilliseconds >= delaiMs) break;
        Thread.Sleep(100);
      }
      var sb = new StringBuilder("{\"changement\":").Append(diff.Count > 0 ? "true" : "false");
      sb.Append(",\"attenteMs\":").Append(sw.ElapsedMilliseconds).Append(",\"element\":").Append(JsonEtat(b));
      sb.Append(",\"changements\":[");
      for (int i = 0; i < diff.Count && i < CHANGEMENTS_MAX; i++) sb.Append(i > 0 ? "," : "").Append(Js(diff[i]));
      if (diff.Count > CHANGEMENTS_MAX) sb.Append(",").Append(Js("... et " + (diff.Count - CHANGEMENTS_MAX) + " autres changements"));
      sb.Append("],\"fenetres\":[");
      int n = 0;
      foreach (var t in b.Fenetres.Values) { if (n >= TITRES_MAX) break; sb.Append(n++ > 0 ? "," : "").Append(Js(t)); }
      return sb.Append("]}").ToString();
    });
  }

  /** Compatibilite : appui sans repere ni remplissage. */
  public static Resultat Appuyer(string bureau, string cible, int ox, int oy) { return Appuyer(bureau, cible, ox, oy, "", false, ""); }

  /**
   * Appui par repere (@lecture:eN, lu dans `fichier`) ou par nom : identifiant exact, puis nom ou libelle
   * exact, puis la meme chose sans la casse, puis « contient » (sans la casse).
   * `remplir` : REMPLIT le champ avec `valeur` (ValuePattern.SetValue, toutes technologies) au lieu
   * d'appuyer. Un booleen a part, car PowerShell passe $null a une chaine .NET comme "" (vider un champ
   * reste donc possible).
   * Appui : element WPF actif -> motif d'accessibilite ; sinon Appui = "clic" et X/Y = centre en pixels
   * de l'ecran du bureau, que hdesk-act.ps1 clique par son chemin habituel ; un element hors ecran est
   * d'abord amene a l'ecran (ScrollItemPattern) quand il le permet.
   * ox/oy : origine de la capture recadree, pour citer des positions en pixels de l'IMAGE dans les refus.
   */
  public static Resultat Appuyer(string bureau, string cible, int ox, int oy, string fichier, bool remplir, string valeur) {
    cible = (cible ?? "").Trim();
    return SurLeBureau(bureau, d => {
      var r = new Resultat();
      var els = Collecter(d, new List<string>());
      if (els.Count == 0) {
        r.Code = "SANS_ARBRE";
        r.Erreur = "Aucun element lisible dans ce bureau (page web, rendu GPU ou fenetre sans arbre d'accessibilite) : vise x/y sur l'image de bureau_cache_observer.";
        return r;
      }
      Element el;
      if (cible.StartsWith("@")) {
        el = ParRepere(els, cible, fichier, r, ox, oy);
        if (el == null) return r;
      } else {
        PoserReperes(els, fichier);
        var t = Filtrer(els, e => e.Id == cible);
        if (t.Count == 0) t = Filtrer(els, e => e.Nom == cible || e.Libelle == cible);
        if (t.Count == 0) t = Filtrer(els, e => string.Equals(e.Nom, cible, StringComparison.OrdinalIgnoreCase) || string.Equals(e.Libelle, cible, StringComparison.OrdinalIgnoreCase));
        if (t.Count == 0) {
          string bas = cible.ToLowerInvariant();
          t = Filtrer(els, e => e.Nom.ToLowerInvariant().Contains(bas) || e.Libelle.ToLowerInvariant().Contains(bas) || e.Id.ToLowerInvariant().Contains(bas));
        }
        if (t.Count == 0) { r.Code = "INTROUVABLE"; r.Erreur = Introuvable(els, cible, ox, oy); return r; }
        el = Departager(t);
        if (el == null) { r.Code = "AMBIGU"; r.Erreur = Ambigu(t, cible, ox, oy); return r; }
      }
      if (!el.Actif) { r.Code = "INACTIF"; r.Erreur = "Element inactif, rien n'a ete appuye :\n" + Decrit(el, ox, oy); return r; }
      r.Json = JsonElement(el, ox, oy);
      r.Rid = el.Rid;
      r.Hwnd = el.Hwnd;
      r.Avant = Instantane(d, el.Hwnd, el.Rid);
      if (remplir) {
        if (el.MotDePasse) { r.Code = "REFUSE"; r.Erreur = "Champ mot de passe : sa saisie revient a l'utilisateur, rien n'a ete rempli :\n" + Decrit(el, ox, oy); return r; }
        if (!el.AValeur) { r.Code = "REFUSE"; r.Erreur = "Cet element n'a pas de valeur a remplir : clique dedans (x/y) puis tape le texte.\n" + Decrit(el, ox, oy); return r; }
        try {
          var vp = (ValuePattern)el.Ae.GetCurrentPattern(ValuePattern.Pattern);
          if (vp.Current.IsReadOnly) { r.Code = "REFUSE"; r.Erreur = "Champ en lecture seule, rien n'a ete rempli :\n" + Decrit(el, ox, oy); return r; }
          vp.SetValue(valeur ?? "");
          r.Appui = "accessibilite:SetValue";
        } catch (Exception e) {
          r.Code = "REFUSE";
          r.Erreur = "Remplissage par l'accessibilite refuse (" + e.GetType().Name + " : " + e.Message + ") : clique dans le champ (x/y) puis tape le texte.\n" + Decrit(el, ox, oy);
        }
        return r;
      }
      if (el.Techno == "WPF" && (el.Invoke || el.Toggle || el.Selection || el.Deplier)) {
        try {
          if (el.Invoke) { ((InvokePattern)el.Ae.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); r.Appui = "accessibilite:Invoke"; }
          else if (el.Toggle) { ((TogglePattern)el.Ae.GetCurrentPattern(TogglePattern.Pattern)).Toggle(); r.Appui = "accessibilite:Toggle"; }
          else if (el.Selection) { ((SelectionItemPattern)el.Ae.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); r.Appui = "accessibilite:Select"; }
          else {
            var p = (ExpandCollapsePattern)el.Ae.GetCurrentPattern(ExpandCollapsePattern.Pattern);
            if (p.Current.ExpandCollapseState == ExpandCollapseState.Collapsed) p.Expand(); else p.Collapse();
            r.Appui = "accessibilite:ExpandCollapse";
          }
        } catch (Exception e) {
          r.Code = "REFUSE";
          r.Erreur = "Appui par l'accessibilite refuse (" + e.GetType().Name + " : " + e.Message + ") :\n" + Decrit(el, ox, oy);
        }
        return r;
      }
      if ((!el.AvecRect || el.HorsEcran) && el.Defiler) {
        // Element hors ecran d'une liste ou d'une zone qui defile : on l'amene a l'ecran, puis on relit
        // sa position vivante.
        try {
          ((ScrollItemPattern)el.Ae.GetCurrentPattern(ScrollItemPattern.Pattern)).ScrollIntoView();
          Thread.Sleep(150);
          var rc = el.Ae.Current.BoundingRectangle;
          el.HorsEcran = el.Ae.Current.IsOffscreen;
          el.AvecRect = !rc.IsEmpty && !double.IsInfinity(rc.Width) && rc.Width > 0 && rc.Height > 0;
          if (el.AvecRect) { el.X = (int)Math.Round(rc.X); el.Y = (int)Math.Round(rc.Y); el.L = (int)Math.Round(rc.Width); el.H = (int)Math.Round(rc.Height); }
          r.Json = JsonElement(el, ox, oy);
        } catch { }
      }
      if (!el.AvecRect || el.HorsEcran) { r.Code = "HORS_ECRAN"; r.Erreur = "Element hors ecran, aucun point a cliquer :\n" + Decrit(el, ox, oy); return r; }
      r.Appui = "clic";
      r.X = el.X + el.L / 2;
      r.Y = el.Y + el.H / 2;
      return r;
    });
  }
}
