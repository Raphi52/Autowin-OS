using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Rig.Pilote.MotsDirecteurs {

/// <summary>Type d'affaire portant les mots directeurs. Détermine les codes admis.</summary>
public enum TypeAffaire { Instance, ProcedureCollective, Prevention }

public enum GraviteAnomalie { Erreur, Avertissement }

public sealed record Anomalie(string Mot, GraviteAnomalie Gravite, string Message);

/// <summary>
/// Les deux règles des mots directeurs de PROC_MDJUD, extraites de l'écran et rendues PURES.
///
/// Source lue : D:/RigApplication/Source/RIG/DLL/Processus/PROC_MDJUD/OPE_MD.cs
///   - Normaliser  <- DoSauve      (lignes ~84-92)
///   - Valider     <- DoVerifier   (lignes ~95-121)
///   - CodesAdmis  <- CodeMotsDirecteurs.cs (3 énumérations)
///
/// Aucune dépendance : ni base, ni écran, ni moteur. C'est tout l'intérêt du pilote — ces règles
/// se testent et se comparent à l'ancien comportement sans rien démarrer.
/// </summary>
public static class ReglesMotsDirecteurs {

    /// <summary>Codes admis par type d'affaire, recopiés des énumérations de l'écran.</summary>
    public static IReadOnlyList<(string Code, string Libelle)> CodesAdmis(TypeAffaire type) => type switch {
        TypeAffaire.Instance => new[] {
            ("NR", "Numéro de l'Instance"), ("NI", "Nom de l'Instance"),
            ("MN", "Nom des demandeurs"), ("MS", "Siren des demandeurs"),
            ("MA", "Adresse des demandeurs"), ("MM", "Nom des mandataires des demandeurs"),
            ("FN", "Nom des défendeurs"), ("FS", "Siren des défendeurs"),
            ("FA", "Adresse des défendeurs"), ("MF", "Nom des mandataires des defendeurs"),
            ("DD", "Date des décisions Judiciaires"), ("JG", "Nom du juge rapporteur"),
            ("JU", "Nom du juge"), ("MI", "Nom des intervenants"), ("SI", "Siren des intervenants")
        },
        TypeAffaire.ProcedureCollective => new[] {
            ("SE", "Numéro Siren"), ("NP", "Numéro de la PC"), ("NA", "Nom de la PC"),
            ("DE", "Désignation de l'entreprise"), ("DI", "Nom des dirigeants"),
            ("JU", "Nom du juge commissaire ou juge commissaire suppléant")
        },
        TypeAffaire.Prevention => new[] {
            ("NA", "Nom de l'affaire"), ("SE", "Numéro Siren"), ("NV", "Numéro de la prévention"),
            ("PA", "Nom de la prévention"), ("DE", "Désignation de l'entreprise"),
            ("DI", "Nom des dirigeants")
        },
        _ => throw new NotSupportedException($"Type d'affaire non géré : {type}")
    };

    private static readonly Regex EspacesMultiples = new(@"\s+", RegexOptions.Compiled);
    /// <summary>
    /// Motif de l'original. `*` autorise le vide ET les ancres exigent un mot ENTIÈREMENT
    /// alphabétique : un mot contenant un chiffre ou un tiret ne matche pas, donc sa casse
    /// n'est PAS retouchée. Comportement conservé tel quel (cf. test CasseNonTouchee...).
    /// </summary>
    private static readonly Regex MotAlphabetique = new(@"^[a-zA-Z]*$", RegexOptions.Compiled);

    /// <summary>
    /// RÈGLE 1 — normalisation à l'enregistrement. Espaces de bord retirés, espaces multiples
    /// réduits à un seul, puis pour chaque mot de PLUS DE DEUX lettres : deux premières lettres
    /// en majuscules, le reste en minuscules. Un mot de 1 ou 2 caractères est laissé intact.
    /// </summary>
    public static string Normaliser(string valeur) {
        if (valeur is null) return string.Empty;
        var v = EspacesMultiples.Replace(valeur.Trim(), " ");
        var mots = v.Split(' ');
        return string.Join(" ", mots.Select(mot =>
            MotAlphabetique.Replace(mot, m =>
                mot.Length > 2
                    ? m.Value.Substring(0, 2).ToUpper() + m.Value.Substring(2).ToLower()
                    : mot)));
    }

    /// <summary>
    /// RÈGLE 2 — validation avant enregistrement. Chaque mot doit faire au moins 3 caractères et
    /// commencer par un code admis pour le type d'affaire.
    ///
    /// TOLÉRANCE À L'HISTORIQUE, à ne surtout pas perdre : un mot au préfixe inconnu qui figurait
    /// DÉJÀ dans `valeurInitiale` ne bloque pas — il ressort en avertissement. Sans elle, un agent
    /// ne peut plus enregistrer un dossier qu'il n'a pas abîmé. C'est le piège du portage vers un
    /// service sans mémoire : `valeurInitiale` doit être RELUE en base avant de valider.
    ///
    /// Le seuil des 3 caractères, lui, bloque TOUJOURS — y compris sur de l'historique. Fidèle à
    /// l'original, qui n'applique la tolérance qu'au contrôle de préfixe.
    /// </summary>
    public static IReadOnlyList<Anomalie> Valider(string valeur, string valeurInitiale, TypeAffaire type) {
        var anomalies = new List<Anomalie>();
        var mots = (valeur ?? string.Empty).Split(' ');
        var motsInitiaux = (valeurInitiale ?? string.Empty).Split(' ');
        var codes = CodesAdmis(type).Select(c => c.Code).ToHashSet(StringComparer.Ordinal);

        foreach (var mot in mots) {
            if (mot.Length == 0) continue;
            if (mot.Length < 3) {
                anomalies.Add(new Anomalie(mot, GraviteAnomalie.Erreur,
                    $"Le mot '{mot}' doit faire au moins 3 caractères"));
                continue;
            }
            var prefixe = mot.Substring(0, 2).ToUpper();
            if (!codes.Contains(prefixe)) {
                var gravite = motsInitiaux.Contains(mot, StringComparer.Ordinal)
                    ? GraviteAnomalie.Avertissement
                    : GraviteAnomalie.Erreur;
                anomalies.Add(new Anomalie(mot, gravite,
                    $"Le mot '{mot}' doit commencer par un code mot directeur existant"));
            }
        }
        return anomalies;
    }

    /// <summary>Vrai si rien n'empêche l'enregistrement (les avertissements ne bloquent pas).</summary>
    public static bool PeutEnregistrer(IReadOnlyList<Anomalie> anomalies) =>
        !anomalies.Any(a => a.Gravite == GraviteAnomalie.Erreur);
}
}
