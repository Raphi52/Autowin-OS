using System;
using System.Collections.Generic;
using System.Linq;
using Rig.Pilote.MotsDirecteurs;
using static Rig.Pilote.MotsDirecteurs.ReglesMotsDirecteurs;

/// <summary>
/// Tests des deux règles. Aucun cadre externe : chaque test est une assertion, le programme rend
/// 0 si tout passe et 1 sinon — donc « vert » se prouve par le code de sortie, pas par une phrase.
/// </summary>
static class Tests {
    static int echecs = 0, total = 0;

    static void Verifie(string nom, object attendu, object obtenu) {
        total++;
        var a = Rendu(attendu); var o = Rendu(obtenu);
        if (a == o) { Console.WriteLine($"  ok   {nom}"); }
        else { echecs++; Console.WriteLine($"  ECHEC {nom}\n         attendu : {a}\n         obtenu  : {o}"); }
    }
    static string Rendu(object v) => v switch {
        null => "<null>",
        string s => $"\"{s}\"",
        IEnumerable<Anomalie> l => "[" + string.Join(" | ", l.Select(x => $"{x.Gravite}:{x.Mot}")) + "]",
        _ => v.ToString()!
    };

    static int Main() {
        Console.WriteLine("REGLE 1 — normalisation (source : OPE_MD.DoSauve)");
        Verifie("espaces de bord retires", "NRabc", Normaliser("  nrabc  "));
        Verifie("espaces multiples reduits a un seul", "NRun NIdeux", Normaliser("nrun    nideux"));
        Verifie("tabulation et retour ligne comptent comme espace", "NRun NIdeux", Normaliser("nrun\t\nnideux"));
        Verifie("deux premieres lettres en majuscules, reste en minuscules", "NRdupont", Normaliser("nrDUPONT"));
        Verifie("mot de 2 caracteres laisse intact", "nr", Normaliser("nr"));
        Verifie("mot de 1 caractere laisse intact", "n", Normaliser("n"));
        Verifie("mot de 3 caracteres normalise", "NRa", Normaliser("nra"));
        Verifie("casse non touchee si le mot contient un chiffre", "nr123abc", Normaliser("nr123abc"));
        Verifie("casse non touchee si le mot contient un tiret", "nr-dupont", Normaliser("nr-dupont"));
        Verifie("chaine vide reste vide", "", Normaliser(""));
        Verifie("que des espaces donne une chaine vide", "", Normaliser("     "));
        Verifie("null traite comme vide", "", Normaliser(null!));
        Verifie("plusieurs mots normalises independamment", "NRdupont MNmartin nr12", Normaliser("nrDUPONT   mnMARTIN nr12"));

        Console.WriteLine("\nREGLE 2 — validation (source : OPE_MD.DoVerifier)");
        Verifie("mot valide sur instance : aucune anomalie",
            new List<Anomalie>(), Valider("NRDupont", "", TypeAffaire.Instance));
        Verifie("mot de moins de 3 caracteres : erreur bloquante",
            new[] { new Anomalie("NR", GraviteAnomalie.Erreur, "") },
            Valider("NR", "", TypeAffaire.Instance));
        Verifie("prefixe inconnu et mot nouveau : erreur bloquante",
            new[] { new Anomalie("ZZDupont", GraviteAnomalie.Erreur, "") },
            Valider("ZZDupont", "", TypeAffaire.Instance));
        Verifie("prefixe inconnu mais mot DEJA present : avertissement seulement",
            new[] { new Anomalie("ZZDupont", GraviteAnomalie.Avertissement, "") },
            Valider("ZZDupont", "ZZDupont", TypeAffaire.Instance));
        Verifie("tolerance exacte : un mot different du meme prefixe reste bloquant",
            new[] { new Anomalie("ZZMartin", GraviteAnomalie.Erreur, "") },
            Valider("ZZMartin", "ZZDupont", TypeAffaire.Instance));
        Verifie("seuil de 3 caracteres bloque MEME sur de l'historique",
            new[] { new Anomalie("NR", GraviteAnomalie.Erreur, "") },
            Valider("NR", "NR", TypeAffaire.Instance));
        Verifie("prefixe reconnu en minuscules (comparaison en majuscules)",
            new List<Anomalie>(), Valider("nrdupont", "", TypeAffaire.Instance));
        Verifie("mots vides ignores",
            new List<Anomalie>(), Valider("NRDupont   MNMartin", "", TypeAffaire.Instance));
        Verifie("chaine vide : aucune anomalie",
            new List<Anomalie>(), Valider("", "", TypeAffaire.Instance));
        Verifie("plusieurs anomalies rapportees dans l ordre de saisie",
            new[] { new Anomalie("NR", GraviteAnomalie.Erreur, ""), new Anomalie("ZZa", GraviteAnomalie.Erreur, "") },
            Valider("NR NRok ZZa", "", TypeAffaire.Instance));

        Console.WriteLine("\nCODES ADMIS — dependants du type d'affaire");
        Verifie("NR est admis sur instance", new List<Anomalie>(), Valider("NRabc", "", TypeAffaire.Instance));
        Verifie("NR n est PAS admis sur procedure collective",
            new[] { new Anomalie("NRabc", GraviteAnomalie.Erreur, "") },
            Valider("NRabc", "", TypeAffaire.ProcedureCollective));
        Verifie("NP est admis sur procedure collective", new List<Anomalie>(), Valider("NPabc", "", TypeAffaire.ProcedureCollective));
        Verifie("NP n est PAS admis sur prevention",
            new[] { new Anomalie("NPabc", GraviteAnomalie.Erreur, "") },
            Valider("NPabc", "", TypeAffaire.Prevention));
        Verifie("NV est admis sur prevention", new List<Anomalie>(), Valider("NVabc", "", TypeAffaire.Prevention));
        Verifie("JU admis sur instance ET procedure collective", new List<Anomalie>(),
            Valider("JUabc", "", TypeAffaire.ProcedureCollective));
        Verifie("nombre de codes instance", 15, CodesAdmis(TypeAffaire.Instance).Count);
        Verifie("nombre de codes procedure collective", 6, CodesAdmis(TypeAffaire.ProcedureCollective).Count);
        Verifie("nombre de codes prevention", 6, CodesAdmis(TypeAffaire.Prevention).Count);

        Console.WriteLine("\nENCHAINEMENT — validation puis enregistrement");
        Verifie("un avertissement seul n empeche pas d enregistrer", true,
            PeutEnregistrer(Valider("ZZDupont", "ZZDupont", TypeAffaire.Instance)));
        Verifie("une erreur empeche d enregistrer", false,
            PeutEnregistrer(Valider("ZZDupont", "", TypeAffaire.Instance)));
        Verifie("la validation porte sur la saisie BRUTE, avant normalisation", false,
            PeutEnregistrer(Valider("zz", "", TypeAffaire.Instance)));

        Console.WriteLine($"\n{total - echecs}/{total} tests passes.");
        return echecs == 0 ? 0 : 1;
    }
}
