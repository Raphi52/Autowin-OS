namespace RigV3Desktop;
using System.Globalization;
using System.Text;
public sealed record Resultat(NoeudGed[] Chemin, int Rang);

// ============================================================
// Recherche d'un ELEMENT dans l'arbre GED d'une affaire.
//
// La barre de recherche de l'accueil ne trouvait que des AFFAIRES
// (numero, objet, siren). Or un utilisateur tape aussi un numero de
// DEPOT (« 2024/0141 »), de FORMALITE (« 2024/00218 ») ou une LIASSE :
// ces valeurs vivent dans les libelles des noeuds de l'arbre
// (Metier/ArbreGed.cs). Ce module les y retrouve et rend le CHEMIN du
// noeud, pour que l'accueil puisse ouvrir l'affaire directement
// depliee sur l'element tape.
//
// Le chemin est une suite de LIBELLES (racine exclue) : l'arbre est
// reconstruit a chaque ouverture d'affaire, donc une reference d'objet
// ne survivrait pas au passage.
// ============================================================
public static class RechercheArbre
{
    /// <summary>
    /// Compare des numeros comme un humain : « 2024/0141 », « 2024 0141 »
    /// et « 20240141 » sont le meme numero, et la casse ne compte pas.
    /// </summary>
    public static string Normaliser(string texte)
        => new string([.. texte.Where(char.IsLetterOrDigit)]).ToUpperInvariant();

    public static bool Correspond(string libelle, string terme)
    {
        var t = Normaliser(terme);
        return t.Length >= 2 && Normaliser(libelle).Contains(t, StringComparison.Ordinal);
    }

    /// <summary>
    /// Les chemins (libelles, racine exclue) des noeuds dont le libelle
    /// porte le terme. Vide si le terme fait moins de 2 caracteres utiles.
    /// </summary>
    public static List<string[]> Chemins(NoeudGed racine, string terme, int max = 6)
    {
        var trouves = new List<string[]>();
        if (Normaliser(terme).Length < 2) return trouves;
        Descendre(racine, [], terme, max, trouves);
        return trouves;
    }

    private static void Descendre(NoeudGed noeud, string[] chemin, string terme,
                                  int max, List<string[]> trouves)
    {
        foreach (var e in noeud.Enfants)
        {
            if (trouves.Count >= max) return;
            string[] ici = [.. chemin, e.Libelle];
            if (Correspond(e.Libelle, terme)) trouves.Add(ici);
            Descendre(e, ici, terme, max, trouves);
        }
    }

    /// <summary>
    /// Retrouve, dans un arbre RECONSTRUIT, la suite de noeuds designee par
    /// un chemin de libelles : le dernier est l'element cherche, les
    /// precedents sont ses parents (a deplier). Null si le chemin n'existe
    /// plus (l'utilisateur a pu masquer ou renommer le noeud).
    /// </summary>
    public static NoeudGed[]? Suivre(NoeudGed racine, string[] chemin)
    {
        var suite = new List<NoeudGed>();
        var courant = racine;
        foreach (var libelle in chemin)
        {
            var enfant = courant.Enfants.FirstOrDefault(e => e.Libelle == libelle);
            if (enfant is null) return null;
            suite.Add(enfant);
            courant = enfant;
        }
        return suite.Count > 0 ? [.. suite] : null;
    }

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

    public static List<(NoeudGed[] c, int r)> RechercherRef(NoeudGed racine, string terme, int max)
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

    public static List<Resultat> Rechercher(NoeudGed racine, string terme, int max = 6) => RechercherRef(racine, terme, max).Select(x => new Resultat(x.c, x.r)).ToList();
}
