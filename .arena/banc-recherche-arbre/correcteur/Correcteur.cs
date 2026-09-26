using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Globalization;
using System.Text;
using RigV3Desktop;

// Correcteur CACHE du banc « recherche classee ». Note sur 100 :
//   80 pts : cas (1 pt si exact, 0,5 si bons noeuds+rangs mais mauvais ordre), ramenes sur 80
//   10 pts : performance 50 000 noeuds (<150 ms = 10, <400 ms = 5)
//   10 pts : compatibilite Normaliser/Correspond/Chemins/Suivre
// Sortie finale : « NOTE <n>/100 ».

static NoeudGed N(string lib, params NoeudGed[] kids)
    => new(lib, "", "", 0, "", "", "", kids.Length == 0 ? Array.Empty<NoeudGed>() : kids);

var casTotal = 0.0; var casPoints = 0.0; var ko = new List<string>();

void Cas(string nom, NoeudGed racine, string terme, int max)
{
    casTotal++;
    var attendu = Ref.Rechercher(racine, terme, max);
    List<(NoeudGed[] c, int r)> obtenu;
    try
    {
        obtenu = RechercheArbre.Rechercher(racine, terme, max)
                 .Select(x => (x.Chemin, x.Rang)).ToList();
    }
    catch (Exception e) { ko.Add($"{nom} : exception {e.GetType().Name}"); return; }
    static string Cle((NoeudGed[] c, int r) x)
        => x.r + ":" + string.Join(",", x.c.Select(n => RuntimeHelpers.GetHashCode(n)));
    var a = attendu.Select(Cle).ToList(); var o = obtenu.Select(Cle).ToList();
    if (a.SequenceEqual(o)) { casPoints++; return; }
    if (a.OrderBy(s => s).SequenceEqual(o.OrderBy(s => s))) { casPoints += 0.5; ko.Add($"{nom} : ordre faux"); return; }
    ko.Add($"{nom} : attendu [{Aff(attendu)}] obtenu [{Aff(obtenu)}]");
}
static string Aff(List<(NoeudGed[] c, int r)> l)
    => string.Join(" | ", l.Select(x => $"{x.r}:{string.Join(">", x.c.Select(n => n.Libelle))}"));

// ---------- Arbre A : realiste
var liasseA = N("Liasse greffe"); var liasseB = N("Liasse greffe");
var A = N("racine",
    N("Dossier RCS",
        N("Dépôt 2024/0141 - 3 p."),
        N("Dépôt 2024/01410"),
        N("Formalité 2024/00218", liasseA, liasseB),
        N("Pièces", N("Kbis"), N("Statuts à jour"))),
    N("Liasse greffe"),
    N("Correspondance",
        N("Courrier Élise"), N("COURRIER ELISE"),
        N("Réf. 12-2024/0141"), N("X20240141"), N("120240141"), N("Kbis 2023")));

string[] termesA = [
    "2024/0141", "2024 0141", "20240141", "2024 0141", "0141", "01410", "2024/00218",
    "Liasse greffe", "liasse", "greffe", "reffe", "Kbis", "kbiss", "Statut", "statuts a jour",
    "STATUTS À JOUR", "Élise", "Élise", "elise", "Courier", "courrier elise", "Dossier",
    "Dossiex", "Pièce", "2023", "12", "a", "é", "//", "", "   ", "zzzzzz", "Formalite", "0218"];
foreach (var t in termesA) Cas($"A « {t} »", A, t, 6);
foreach (var m in new[] { 1, 2, 3, 0, -1, 100 }) Cas($"A « Liasse » max={m}", A, "Liasse", m);
Cas("A « 2024 » max=2", A, "2024", 2);

// ---------- Arbre B : homonymes a plusieurs profondeurs
var B = N("racine",
    N("Classeur", N("Pièce", N("Pièce"), N("Pièce")), N("Pièce")),
    N("Pièce"),
    N("Annexe", N("Autre", N("Pièce"))));
Cas("B « Piece »", B, "Piece", 10);
Cas("B « Piece » max=3", B, "Piece", 3);
Cas("B « Pieces » (typo)", B, "Pieces", 10);
Cas("B « Classeurs » (typo)", B, "Classeurs", 10);

// ---------- Arbre C : faute de frappe et bornes de nombre
var C = N("racine", N("Dépôt 2024/01410"), N("Dossier 2024 bis"));
Cas("C « 20240141 » (typo borne)", C, "20240141", 6);
Cas("C « 2024/0142 »", C, "2024/0142", 6);
Cas("C « Dosier »", C, "Dosier", 6);
Cas("C « Dosiers »", C, "Dosiers", 6);
Cas("C « Dossie »", C, "Dossie", 6);
Cas("C « Doss »", C, "Doss", 6);

// ---------- Arbre D : grand, tri transverse
var rnd = new Random(42);
NoeudGed Grand(int prof, ref int n)
{
    var kids = new List<NoeudGed>();
    int nb = prof == 0 ? 50 : prof < 3 ? 10 : 9;
    for (int i = 0; i < nb && prof < 4; i++) { n++; kids.Add(Grand(prof + 1, ref n)); }
    return N($"Dossier {n} Pièce {n % 97} réf {rnd.Next(100000)}", [.. kids]);
}
int compte = 0; var D = N("racine", Grand(0, ref compte).Enfants);
Console.WriteLine($"Arbre D : {Compter(D) - 1} noeuds");
Cas("D « Piece 42 »", D, "Piece 42", 6);
Cas("D « 42 »", D, "42", 20);
Cas("D « Dossiex 4999 »", D, "Dossiex 4999", 6);
Cas("D « Dossier 12 »", D, "Dossier 12", 6);

static int Compter(NoeudGed n) => 1 + n.Enfants.Sum(Compter);

// ---------- Performance
double Mediane(string t)
{
    var l = new List<double>();
    for (int i = 0; i < 6; i++)
    {
        var sw = Stopwatch.StartNew();
        try { RechercheArbre.Rechercher(D, t, 6); } catch { return 9999; }
        l.Add(sw.Elapsed.TotalMilliseconds);
    }
    l.RemoveAt(0); l.Sort(); return l[l.Count / 2];
}
var perfA = Mediane("Piece 42"); var perfB = Mediane("Dossiex 4999"); Console.WriteLine($"Perf detail : exact {perfA:F1} ms, typo {perfB:F1} ms"); var perf = Math.Max(perfA, perfB);
var ptsPerf = perf < 150 ? 10 : perf < 400 ? 5 : 0;

// ---------- Compatibilite
int compat = 0, compatTot = 0;
void Compat(bool ok, string quoi) { compatTot++; if (ok) compat++; else ko.Add("compat : " + quoi); }
try
{
    foreach (var t in new[] { "2024/0141", "Liasse", "é", "a", "0141", "Élise" })
    {
        var o = RechercheArbre.Chemins(A, t).Select(c => string.Join(">", c));
        var r = Ancien.Chemins(A, t).Select(c => string.Join(">", c));
        Compat(o.SequenceEqual(r), $"Chemins « {t} »");
        Compat(RechercheArbre.Correspond("Dépôt 2024/01410", t) == Ancien.Correspond("Dépôt 2024/01410", t), $"Correspond « {t} »");
    }
    Compat(RechercheArbre.Normaliser("Élise 2024/01") == Ancien.Normaliser("Élise 2024/01"), "Normaliser garde les accents");
    var s = RechercheArbre.Suivre(A, ["Dossier RCS", "Formalité 2024/00218", "Liasse greffe"]);
    Compat(s is not null && ReferenceEquals(s[^1], liasseA), "Suivre prend le premier homonyme");
    Compat(RechercheArbre.Suivre(A, ["nope"]) is null, "Suivre chemin disparu -> null");
    Compat(RechercheArbre.Suivre(A, []) is null, "Suivre chemin vide -> null");
}
catch (Exception e) { ko.Add("compat : exception " + e.Message); }
var ptsCompat = compatTot == 0 ? 0 : 10.0 * compat / compatTot;

var ptsCas = 80 * casPoints / casTotal;
foreach (var k in ko) Console.WriteLine("ECHEC  " + k);
Console.WriteLine($"Cas : {casPoints}/{casTotal} -> {ptsCas:F1}/80");
Console.WriteLine($"Perf : {perf:F1} ms -> {ptsPerf}/10");
Console.WriteLine($"Compat : {compat}/{compatTot} -> {ptsCompat:F1}/10");
Console.WriteLine($"NOTE {Math.Round(ptsCas + ptsPerf + ptsCompat)}/100");
return 0;

// ================= REFERENCE =================
static class Ref
{
    record struct Forme(string L, int[] Orig);

    static Forme Norm(string s)
    {
        var sb = new StringBuilder(); var orig = new List<int>();
        for (int k = 0; k < s.Length; k++)
        {
            if (s[k] < 128) { if (char.IsAsciiLetterOrDigit(s[k])) { sb.Append(char.ToUpperInvariant(s[k])); orig.Add(k); } continue; }
            foreach (var ch in s[k].ToString().Normalize(NormalizationForm.FormD))
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
                if (!char.IsLetterOrDigit(ch)) continue;
                sb.Append(char.ToUpperInvariant(ch)); orig.Add(k);
            }
        }
        return new(sb.ToString(), [.. orig]);
    }

    static bool Bornes(string lib, Forme f, int i, int len)
    {
        int s = f.Orig[i], e = f.Orig[i + len - 1];
        if (char.IsDigit(f.L[i]) && s > 0 && char.IsDigit(lib[s - 1])) return false;
        if (char.IsDigit(f.L[i + len - 1]) && e + 1 < lib.Length && char.IsDigit(lib[e + 1])) return false;
        return true;
    }

    static int Rang(string lib, string T)
    {
        var f = Norm(lib);
        if (f.L == T) return 0;
        int best = 99;
        for (int i = f.L.IndexOf(T, StringComparison.Ordinal); i >= 0; i = f.L.IndexOf(T, i + 1, StringComparison.Ordinal))
        {
            if (!Bornes(lib, f, i, T.Length)) continue;
            int s = f.Orig[i];
            best = Math.Min(best, s == 0 || !char.IsLetterOrDigit(lib[s - 1]) ? 1 : 2);
        }
        return best;
    }

    static bool Typo(string lib, string T)
    {
        var f = Norm(lib);
        // Une seule edition : une des deux moities de T apparait telle quelle.
        int h = T.Length / 2;
        if (!f.L.Contains(T[..h], StringComparison.Ordinal) && !f.L.Contains(T[h..], StringComparison.Ordinal)) return false;
        for (int len = Math.Max(1, T.Length - 1); len <= T.Length + 1; len++)
            for (int i = 0; i + len <= f.L.Length; i++)
                if (Dist1(f.L.AsSpan(i, len), T) && Bornes(lib, f, i, len)) return true;
        return false;
    }

    static bool Dist1(ReadOnlySpan<char> a, string b)
    {
        if (a.Length == b.Length) { int d = 0; for (int i = 0; i < a.Length && d < 2; i++) if (a[i] != b[i]) d++; return d == 1; }
        if (Math.Abs(a.Length - b.Length) != 1) return false;
        ReadOnlySpan<char> c = a.Length < b.Length ? a : b, l = a.Length < b.Length ? b : a;
        int p = 0; while (p < c.Length && c[p] == l[p]) p++;
        return c[p..].SequenceEqual(l[(p + 1)..]);
    }

    public static List<(NoeudGed[] c, int r)> Rechercher(NoeudGed racine, string terme, int max)
    {
        var T = Norm(terme ?? "").L;
        var res = new List<(NoeudGed[] c, int r, int ord)>();
        if (T.Length < 2 || max <= 0) return [];
        var tous = new List<NoeudGed[]>();
        void Parcours(NoeudGed n, NoeudGed[] ch) { foreach (var e in n.Enfants) { NoeudGed[] ici = [.. ch, e]; tous.Add(ici); Parcours(e, ici); } }
        Parcours(racine, []);
        for (int k = 0; k < tous.Count; k++) { int r = Rang(tous[k][^1].Libelle, T); if (r < 3) res.Add((tous[k], r, k)); }
        if (res.Count == 0 && T.Length >= 5)
            for (int k = 0; k < tous.Count; k++) if (Typo(tous[k][^1].Libelle, T)) res.Add((tous[k], 3, k));
        return res.OrderBy(x => x.r).ThenBy(x => x.c.Length).ThenBy(x => x.ord)
                  .Take(max).Select(x => (x.c, x.r)).ToList();
    }
}

// Copie de l'implementation d'origine (Metier/RechercheArbre.cs au 2026-09-21).
static class Ancien
{
    public static string Normaliser(string texte) => new string([.. texte.Where(char.IsLetterOrDigit)]).ToUpperInvariant();
    public static bool Correspond(string libelle, string terme)
    { var t = Normaliser(terme); return t.Length >= 2 && Normaliser(libelle).Contains(t, StringComparison.Ordinal); }
    public static List<string[]> Chemins(NoeudGed racine, string terme, int max = 6)
    { var tr = new List<string[]>(); if (Normaliser(terme).Length < 2) return tr; D(racine, [], terme, max, tr); return tr; }
    static void D(NoeudGed n, string[] c, string t, int max, List<string[]> tr)
    { foreach (var e in n.Enfants) { if (tr.Count >= max) return; string[] ici = [.. c, e.Libelle]; if (Correspond(e.Libelle, t)) tr.Add(ici); D(e, ici, t, max, tr); } }
}
