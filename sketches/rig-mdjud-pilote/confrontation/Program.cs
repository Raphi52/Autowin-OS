using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Rig.Pilote.MotsDirecteurs;
using static Rig.Pilote.MotsDirecteurs.ReglesMotsDirecteurs;

/// <summary>
/// Confronte les deux règles extraites de PROC_MDJUD aux valeurs RÉELLEMENT en base.
/// Lecture seule, en flux : le fichier source fait ~600 Mo.
/// </summary>
static class Confrontation {
    static int Main(string[] args) {
        var chemin = args.Length > 0 ? args[0] : "D:/AutoWinOS/md-reels.tsv";
        long lignes = 0, indetermine = 0;
        long bloqueAvecTolerance = 0, bloqueSansTolerance = 0, nonNormalisees = 0;
        long motsTotal = 0;
        var motifsCourts = new Dictionary<string, long>();
        var prefixesInconnus = new Dictionary<string, long>();
        var exemplesCourts = new List<string>();
        var parType = new Dictionary<string, long>();

        foreach (var ligne in File.ReadLines(chemin)) {
            var sep = ligne.IndexOf('\t');
            if (sep < 0) continue;
            var typeTexte = ligne.Substring(0, sep);
            var valeur = ligne.Substring(sep + 1);
            lignes++;
            if (typeTexte == "Indetermine") { indetermine++; continue; }
            var type = Enum.Parse<TypeAffaire>(typeTexte);
            parType.TryGetValue(typeTexte, out var t); parType[typeTexte] = t + 1;

            motsTotal += valeur.Split(' ').Count(m => m.Length > 0);

            // Cas RÉEL de l'écran : la valeur en base EST la valeur initiale -> tolérance active.
            var avec = Valider(valeur, valeur, type);
            // Cas d'un service SANS MÉMOIRE, qui ne relit pas la valeur d'avant.
            var sans = Valider(valeur, "", type);

            if (!PeutEnregistrer(avec)) {
                bloqueAvecTolerance++;
                foreach (var a in avec.Where(x => x.Gravite == GraviteAnomalie.Erreur)) {
                    motifsCourts.TryGetValue(a.Mot, out var n); motifsCourts[a.Mot] = n + 1;
                    if (exemplesCourts.Count < 5) exemplesCourts.Add($"[{a.Mot}] dans « {Court(valeur)} »");
                }
            }
            if (!PeutEnregistrer(sans)) {
                bloqueSansTolerance++;
                foreach (var a in sans.Where(x => x.Gravite == GraviteAnomalie.Erreur && a_Prefixe(x.Mot))) {
                    var p = x_Prefixe(a.Mot);
                    prefixesInconnus.TryGetValue(p, out var n); prefixesInconnus[p] = n + 1;
                }
            }
            if (Normaliser(valeur) != valeur) nonNormalisees++;
        }

        static bool a_Prefixe(string m) => m.Length >= 3;
        static string x_Prefixe(string m) => m.Substring(0, 2).ToUpper();
        static string Court(string v) => v.Length <= 70 ? v : v.Substring(0, 70) + "…";

        Console.WriteLine($"VALEURS LUES EN BASE      : {lignes:N0}");
        Console.WriteLine($"  dont type indetermine   : {indetermine:N0}");
        foreach (var kv in parType.OrderByDescending(k => k.Value))
            Console.WriteLine($"  {kv.Key,-22}: {kv.Value:N0}");
        Console.WriteLine($"MOTS DIRECTEURS AU TOTAL  : {motsTotal:N0}");
        Console.WriteLine();
        Console.WriteLine($"BLOQUEES **avec** tolerance (comportement fidele a l'ecran) : {bloqueAvecTolerance:N0}  ({Pct(bloqueAvecTolerance, lignes)})");
        Console.WriteLine($"BLOQUEES **sans** tolerance (service sans memoire)          : {bloqueSansTolerance:N0}  ({Pct(bloqueSansTolerance, lignes)})");
        Console.WriteLine($"VALEURS non conformes a la normalisation                    : {nonNormalisees:N0}  ({Pct(nonNormalisees, lignes)})");
        Console.WriteLine();
        if (motifsCourts.Count > 0) {
            Console.WriteLine("MOTS DE MOINS DE 3 CARACTERES les plus frequents (bloquent TOUJOURS) :");
            foreach (var kv in motifsCourts.OrderByDescending(k => k.Value).Take(10))
                Console.WriteLine($"  « {kv.Key} » x {kv.Value:N0}");
            Console.WriteLine("Exemples :");
            foreach (var e in exemplesCourts) Console.WriteLine($"  {e}");
            Console.WriteLine();
        }
        if (prefixesInconnus.Count > 0) {
            Console.WriteLine("PREFIXES INCONNUS les plus frequents (bloquent seulement SANS tolerance) :");
            foreach (var kv in prefixesInconnus.OrderByDescending(k => k.Value).Take(12))
                Console.WriteLine($"  « {kv.Key} » x {kv.Value:N0}");
        }
        return 0;

        static string Pct(long n, long t) => t == 0 ? "0 %" : $"{100.0 * n / t:0.00} %";
    }
}
