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
//    Expand/Collapse) ; autre (Win32...) -> clic au centre par hdesk-act (Toggle a echoue sur une case Win32).
// fix-ok: 3 édits mesurés sur une fenêtre WPF réelle (2026-11-03) : le refus « Doublon » citait aussi les 2 étiquettes Text, et « Valider tout » ne citait pas « Valider la saisie » (distance 9 > seuil 7).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
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

  /** Longueur gardee d'un nom, d'un libelle ou d'une valeur. */
  const int TEXTE_MAX = 200;
  /** Candidats cites dans un refus « plusieurs elements » ; plus proches cites dans « introuvable ». */
  const int CANDIDATS_MAX = 10;
  const int PROCHES_MAX = 5;

  public class Element {
    public int Fenetre;
    public string Type = "", Nom = "", Id = "", Libelle = "", Techno = "", Valeur = null, Coche = null;
    public bool Actif, HorsEcran, AvecRect, Invoke, Toggle, Selection, Deplier;
    public int X, Y, L, H;
    public AutomationElement Ae;
    public string Montre() { return Nom != "" ? Nom : (Libelle != "" ? Libelle : Id); }
  }

  public class Resultat {
    public string Erreur;
    public string Appui;
    public string Json = "";
    public int X, Y;
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
    cr.Add(AutomationElement.IsInvokePatternAvailableProperty);
    cr.Add(AutomationElement.IsTogglePatternAvailableProperty);
    cr.Add(AutomationElement.IsSelectionItemPatternAvailableProperty);
    cr.Add(AutomationElement.IsExpandCollapsePatternAvailableProperty);
    cr.Add(AutomationElement.IsValuePatternAvailableProperty);
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
        if (el != null) res.Add(el);
      }
    }
    return res;
  }

  static bool Vrai(AutomationElement e, AutomationProperty p) {
    object v = e.GetCachedPropertyValue(p);
    return v is bool && (bool)v;
  }

  static Element Decrire(AutomationElement e, int f) {
    var el = new Element();
    el.Fenetre = f;
    el.Ae = e;
    bool motDePasse;
    try {
      el.Nom = Propre(e.Cached.Name);
      el.Id = Propre(e.Cached.AutomationId);
      var ct = e.Cached.ControlType;
      el.Type = ct == null ? "" : ct.ProgrammaticName.Replace("ControlType.", "");
      el.Techno = Propre(e.Cached.FrameworkId);
      el.Actif = e.Cached.IsEnabled;
      el.HorsEcran = e.Cached.IsOffscreen;
      motDePasse = e.Cached.IsPassword;
      var r = e.Cached.BoundingRectangle;
      if (!r.IsEmpty && !double.IsInfinity(r.Width) && !double.IsNaN(r.Width) && r.Width > 0 && r.Height > 0) {
        el.AvecRect = true;
        el.X = (int)Math.Round(r.X); el.Y = (int)Math.Round(r.Y);
        el.L = (int)Math.Round(r.Width); el.H = (int)Math.Round(r.Height);
      }
      el.Invoke = Vrai(e, AutomationElement.IsInvokePatternAvailableProperty);
      el.Toggle = Vrai(e, AutomationElement.IsTogglePatternAvailableProperty);
      el.Selection = Vrai(e, AutomationElement.IsSelectionItemPatternAvailableProperty);
      el.Deplier = Vrai(e, AutomationElement.IsExpandCollapsePatternAvailableProperty);
      if (Vrai(e, AutomationElement.IsValuePatternAvailableProperty) && !motDePasse) {
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
    sb.Append(",\"fenetre\":").Append(el.Fenetre);
    return sb.Append('}').ToString();
  }

  // Une ligne lisible pour un refus ; position = CENTRE, en pixels de l'image si l'origine est passee.
  static string Decrit(Element el, int ox, int oy) {
    var sb = new StringBuilder("- ").Append(el.Type).Append(" '").Append(el.Montre()).Append("'");
    if (el.Id != "" && el.Id != el.Montre()) sb.Append(" id=").Append(el.Id);
    if (el.AvecRect) sb.Append(" centre (").Append(el.X + el.L / 2 - ox).Append(",").Append(el.Y + el.H / 2 - oy).Append(")");
    if (!el.Actif) sb.Append(" [inactif]");
    return sb.ToString();
  }

  /** Lecture : JSON {bureau, fenetres, total, omis, elements[]} en pixels de l'ecran du bureau. */
  public static string Lire(string bureau, int plafond) {
    return SurLeBureau(bureau, d => {
      var titres = new List<string>();
      var els = Collecter(d, titres);
      int n = Math.Min(els.Count, Math.Max(0, plafond));
      var sb = new StringBuilder("{\"bureau\":").Append(Js(bureau)).Append(",\"fenetres\":[");
      for (int i = 0; i < titres.Count; i++) sb.Append(i > 0 ? "," : "").Append(Js(titres[i]));
      sb.Append("],\"total\":").Append(els.Count).Append(",\"omis\":").Append(els.Count - n).Append(",\"elements\":[");
      for (int i = 0; i < n; i++) sb.Append(i > 0 ? "," : "").Append(JsonElement(els[i], 0, 0));
      return sb.Append("]}").ToString();
    });
  }

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
      .Append(") : precise par l'identifiant (id) d'un d'eux, ou vise x/y sur l'image.");
    for (int i = 0; i < t.Count && i < CANDIDATS_MAX; i++) sb.Append("\n").Append(Decrit(t[i], ox, oy));
    if (t.Count > CANDIDATS_MAX) sb.Append("\n... et ").Append(t.Count - CANDIDATS_MAX).Append(" autres.");
    return sb.ToString();
  }

  /**
   * Appui par nom : identifiant exact, puis nom ou libelle exact, puis la meme chose sans la casse, puis
   * « contient » (sans la casse). Element WPF actif -> motif d'accessibilite ; sinon Appui = "clic" et
   * X/Y = centre en pixels de l'ecran du bureau, que hdesk-act.ps1 clique par son chemin habituel.
   * ox/oy : origine de la capture recadree, pour citer des positions en pixels de l'IMAGE dans les refus.
   */
  public static Resultat Appuyer(string bureau, string cible, int ox, int oy) {
    cible = (cible ?? "").Trim();
    return SurLeBureau(bureau, d => {
      var r = new Resultat();
      var els = Collecter(d, new List<string>());
      if (els.Count == 0) {
        r.Erreur = "Aucun element lisible dans ce bureau (page web, rendu GPU ou fenetre sans arbre d'accessibilite) : vise x/y sur l'image de bureau_cache_observer.";
        return r;
      }
      var t = Filtrer(els, e => e.Id == cible);
      if (t.Count == 0) t = Filtrer(els, e => e.Nom == cible || e.Libelle == cible);
      if (t.Count == 0) t = Filtrer(els, e => string.Equals(e.Nom, cible, StringComparison.OrdinalIgnoreCase) || string.Equals(e.Libelle, cible, StringComparison.OrdinalIgnoreCase));
      if (t.Count == 0) {
        string bas = cible.ToLowerInvariant();
        t = Filtrer(els, e => e.Nom.ToLowerInvariant().Contains(bas) || e.Libelle.ToLowerInvariant().Contains(bas) || e.Id.ToLowerInvariant().Contains(bas));
      }
      if (t.Count == 0) { r.Erreur = Introuvable(els, cible, ox, oy); return r; }
      var el = Departager(t);
      if (el == null) { r.Erreur = Ambigu(t, cible, ox, oy); return r; }
      if (!el.Actif) { r.Erreur = "Element inactif, rien n'a ete appuye :\n" + Decrit(el, ox, oy); return r; }
      r.Json = JsonElement(el, ox, oy);
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
          r.Erreur = "Appui par l'accessibilite refuse (" + e.GetType().Name + " : " + e.Message + ") :\n" + Decrit(el, ox, oy);
        }
        return r;
      }
      if (!el.AvecRect || el.HorsEcran) { r.Erreur = "Element hors ecran, aucun point a cliquer :\n" + Decrit(el, ox, oy); return r; }
      r.Appui = "clic";
      r.X = el.X + el.L / 2;
      r.Y = el.Y + el.H / 2;
      return r;
    });
  }
}
