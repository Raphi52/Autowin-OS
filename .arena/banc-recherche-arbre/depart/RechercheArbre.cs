namespace RigV3Desktop;

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
}
