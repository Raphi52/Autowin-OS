using System.Collections.Concurrent;
using System.Globalization;
using System.Text;

namespace RigV3Desktop;

/// <summary>
/// Un noeud trouve par <see cref="RechercheArbre.Rechercher"/> : le CHEMIN
/// de noeuds (racine exclue, noeud trouve inclus) et son RANG
/// (0 = libelle identique, 1 = debut de mot, 2 = ailleurs, 3 = faute de frappe).
/// </summary>
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
//
// Rechercher (recherche CLASSEE) rend, elle, des chemins de NOEUDS de
// l'arbre courant, tries par pertinence.
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

    // ------------------------------------------------------------
    // Recherche classee
    // ------------------------------------------------------------

    /// <summary>
    /// Les noeuds dont le libelle porte le terme, classes par rang, puis
    /// profondeur, puis ordre de parcours prefixe ; au plus <paramref name="max"/>.
    /// Chaque chemin (racine exclue, noeud trouve inclus) reference les
    /// objets reels de l'arbre, homonymes compris.
    /// </summary>
    public static List<Resultat> Rechercher(NoeudGed racine, string terme, int max = 6)
    {
        var resultats = new List<Resultat>();
        if (racine is null || terme is null || max <= 0) return resultats;

        var t = Forme.De(terme).Texte;
        if (t.Length < 2) return resultats;

        // 1) Aplatir l'arbre en ordre prefixe (pile explicite : pas de
        //    debordement sur un arbre profond).
        var noeuds = new List<NoeudGed>();
        var parents = new List<int>();
        var profondeurs = new List<int>();
        var formes = new List<Forme>();

        var pile = new Stack<(NoeudGed Noeud, int Parent, int Profondeur)>();
        Empiler(pile, racine.Enfants, -1, 1);
        while (pile.Count > 0)
        {
            var (n, parent, prof) = pile.Pop();
            int ici = noeuds.Count;
            noeuds.Add(n);
            parents.Add(parent);
            profondeurs.Add(prof);
            formes.Add(Forme.De(n.Libelle ?? ""));
            Empiler(pile, n.Enfants, ici, prof + 1);
        }

        // 2) Rangs 0 a 2.
        var trouves = new List<(int Rang, int Index)>();
        for (int i = 0; i < formes.Count; i++)
        {
            int r = RangDirect(formes[i], t);
            if (r >= 0) trouves.Add((r, i));
        }

        // 3) Faute de frappe : seulement si rien d'autre dans tout l'arbre.
        if (trouves.Count == 0 && t.Length >= 5)
        {
            for (int i = 0; i < formes.Count; i++)
                if (Approche(formes[i], t)) trouves.Add((3, i));
        }

        // 4) Tri : rang, profondeur, ordre de parcours.
        trouves.Sort((a, b) =>
        {
            int c = a.Rang.CompareTo(b.Rang);
            if (c != 0) return c;
            c = profondeurs[a.Index].CompareTo(profondeurs[b.Index]);
            return c != 0 ? c : a.Index.CompareTo(b.Index);
        });

        // 5) Chemins de noeuds pour les max premiers.
        int nb = Math.Min(max, trouves.Count);
        for (int k = 0; k < nb; k++)
        {
            var (rang, idx) = trouves[k];
            var chemin = new NoeudGed[profondeurs[idx]];
            for (int j = idx, p = chemin.Length - 1; j >= 0 && p >= 0; j = parents[j], p--)
                chemin[p] = noeuds[j];
            resultats.Add(new Resultat(chemin, rang));
        }
        return resultats;
    }

    private static void Empiler(Stack<(NoeudGed, int, int)> pile, NoeudGed[]? enfants,
                                int parent, int profondeur)
    {
        if (enfants is null) return;
        for (int i = enfants.Length - 1; i >= 0; i--)
            if (enfants[i] is not null) pile.Push((enfants[i], parent, profondeur));
    }

    /// <summary>0, 1, 2, ou -1 si aucune occurrence valable.</summary>
    private static int RangDirect(Forme f, string t)
    {
        var l = f.Texte;
        if (l.Length < t.Length) return -1;
        if (l == t) return 0;

        int meilleur = -1;
        int pos = l.IndexOf(t, 0, StringComparison.Ordinal);
        while (pos >= 0)
        {
            if (BornesValables(f, pos, t.Length))
            {
                if (DebutDeMot(f, pos)) return 1;
                meilleur = 2;
            }
            if (pos + 1 > l.Length - t.Length) break;
            pos = l.IndexOf(t, pos + 1, StringComparison.Ordinal);
        }
        return meilleur;
    }

    /// <summary>
    /// Existe-t-il une sous-chaine de L, aux bornes valables, a distance
    /// d'edition exactement 1 de T ?
    /// </summary>
    private static bool Approche(Forme f, string t)
    {
        var l = f.Texte;
        int m = t.Length, n = l.Length;
        if (n < m - 1) return false;

        for (int i = 0; i < n; i++)
        {
            for (int k = m - 1; k <= m + 1; k++)
            {
                if (k <= 0 || i + k > n) continue;
                if (!UnEcart(l.AsSpan(i, k), t)) continue;
                if (BornesValables(f, i, k)) return true;
            }
        }
        return false;
    }

    /// <summary>Distance d'edition exactement 1 entre s et t.</summary>
    private static bool UnEcart(ReadOnlySpan<char> s, ReadOnlySpan<char> t)
    {
        if (s.Length == t.Length)
        {
            int diff = 0;
            for (int i = 0; i < s.Length; i++)
                if (s[i] != t[i] && ++diff > 1) return false;
            return diff == 1;
        }

        // Longueurs differant d'un : on retire un caractere a la plus longue
        // au premier desaccord.
        var longue = s.Length > t.Length ? s : t;
        var courte = s.Length > t.Length ? t : s;
        if (longue.Length - courte.Length != 1) return false;

        int p = 0;
        while (p < courte.Length && longue[p] == courte[p]) p++;
        return longue[(p + 1)..].SequenceEqual(courte[p..]);
    }

    /// <summary>
    /// Regle 3 : la sous-chaine normalisee [pos, pos+len) ne coupe pas un
    /// nombre dans le libelle d'origine.
    /// </summary>
    private static bool BornesValables(Forme f, int pos, int len)
    {
        var l = f.Texte;
        if (char.IsDigit(l[pos]))
        {
            int j = Precedent(f.Origine, f.Index[pos]);
            if (j >= 0 && char.IsDigit(f.Origine[j])) return false;
        }
        int fin = pos + len - 1;
        if (char.IsDigit(l[fin]))
        {
            int j = Suivant(f.Origine, f.Index[fin]);
            if (j >= 0 && char.IsDigit(f.Origine[j])) return false;
        }
        return true;
    }

    /// <summary>L'occurrence commence au debut d'un mot du libelle d'origine.</summary>
    private static bool DebutDeMot(Forme f, int pos)
    {
        int idx = f.Index[pos];
        // Occurrence commencant au milieu d'un caractere decompose en plusieurs lettres.
        if (pos > 0 && f.Index[pos - 1] == idx) return false;
        int j = Precedent(f.Origine, idx);
        return j < 0 || !char.IsLetterOrDigit(f.Origine[j]);
    }

    /// <summary>
    /// Indice du caractere d'origine precedent, en sautant les accents
    /// combinants (qui font partie de la lettre qu'ils suivent). -1 si aucun.
    /// </summary>
    private static int Precedent(string o, int idx)
    {
        int j = idx - 1;
        while (j >= 0 && EstMarque(o[j])) j--;
        return j;
    }

    /// <summary>Indice du caractere d'origine suivant (accents combinants sautes). -1 si aucun.</summary>
    private static int Suivant(string o, int idx)
    {
        int j = idx + 1;
        while (j < o.Length && EstMarque(o[j])) j++;
        return j < o.Length ? j : -1;
    }

    private static bool EstMarque(char c)
    {
        if (c < 0x0300) return false;
        var cat = CharUnicodeInfo.GetUnicodeCategory(c);
        return cat is UnicodeCategory.NonSpacingMark
                   or UnicodeCategory.SpacingCombiningMark
                   or UnicodeCategory.EnclosingMark;
    }

    // ------------------------------------------------------------
    // Forme normalisee N(s) avec correspondance vers le libelle d'origine
    // ------------------------------------------------------------

    private static readonly ConcurrentDictionary<char, string> Decompositions = new();

    private static string Decomposer(char c)
        => Decompositions.GetOrAdd(c, static ch =>
        {
            try { return ch.ToString().Normalize(NormalizationForm.FormD); }
            catch (ArgumentException) { return ch.ToString(); }
        });

    /// <summary>
    /// N(s) : accents retires, majuscules, lettres et chiffres seulement.
    /// Index[i] = indice, dans Origine, du caractere qui a produit Texte[i].
    /// </summary>
    private sealed class Forme
    {
        public required string Texte { get; init; }
        public required string Origine { get; init; }
        public required int[] Index { get; init; }

        public static Forme De(string s)
        {
            var sb = new StringBuilder(s.Length);
            var index = new List<int>(s.Length);

            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c < 128)
                {
                    if (c is >= 'a' and <= 'z') { sb.Append((char)(c - 32)); index.Add(i); }
                    else if (c is >= 'A' and <= 'Z' or >= '0' and <= '9') { sb.Append(c); index.Add(i); }
                    continue;
                }
                if (char.IsSurrogate(c)) continue;

                foreach (char d in Decomposer(c))
                {
                    if (!char.IsLetterOrDigit(d)) continue; // accents combinants, ponctuation...
                    sb.Append(char.ToUpperInvariant(d));
                    index.Add(i);
                }
            }

            return new Forme { Texte = sb.ToString(), Origine = s, Index = [.. index] };
        }
    }
}
