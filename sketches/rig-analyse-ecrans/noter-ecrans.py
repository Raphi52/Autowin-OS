"""Note les ecrans PROC_* de RIG par difficulte de migration. LECTURE SEULE sur le depot RIG.

Sortie : ecrans-notes.csv a cote de ce script (separateur point-virgule, ouvrable dans Excel).
Usage  : python noter-ecrans.py [racine_des_PROC]

La note est un CLASSEMENT, pas une estimation en jours : elle pondere ce qu il faudra RECRIRE
a la main (regles de saisie posees sur des controles, SQL en dur, pilotage d affichage,
validations attachees a un champ visuel), plus un poids de volume.
"""
import os, re, csv, sys, statistics

RACINE = sys.argv[1] if len(sys.argv) > 1 else r"D:/RigApplication/Source/RIG/DLL/Processus"
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ecrans-notes.csv")

MOTIFS = {
    "sql_dur": re.compile(r"\b(SELECT\s+|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)", re.I),
    # SetVisible/DialogBox/GetFormAutomate sont les formes REELLES dans RIG : les omettre
    # sous-estime massivement le couplage (1 125 occurrences manquees le 2026-09-02).
    "affichage": re.compile(r"\.(Visible|Enabled)\s*=|\.Focus\(\)|SetVisible\(|DialogBox\.Show|GetFormAutomate\("),
    "regle_saisie": re.compile(r"Metier(Obligatoire|ReadOnly)\s*="),
    "validation_ui": re.compile(r"new\s+ErreurValidation\("),
    "evenement": re.compile(r"_ChangementValeur\s*\(|_Click\s*\(|_Leave\s*\("),
    "liaison": re.compile(r"\.Link\("),
}
POIDS = {"regle_saisie": 3, "sql_dur": 4, "affichage": 1, "validation_ui": 2, "evenement": 1}

def noter(dossier):
    c = {k: 0 for k in MOTIFS}
    lignes = fichiers = 0
    for base, sous, fics in os.walk(dossier):
        sous[:] = [d for d in sous if d not in ("obj", "bin", ".vs")]
        for f in fics:
            if not f.endswith(".cs") or f.endswith(".Designer.cs"):
                continue
            try:
                texte = open(os.path.join(base, f), encoding="utf-8-sig", errors="replace").read()
            except OSError:
                continue
            fichiers += 1
            lignes += texte.count("\n") + 1
            for cle, motif in MOTIFS.items():
                c[cle] += len(motif.findall(texte))
    if fichiers == 0:
        return None
    note = sum(c[k] * p for k, p in POIDS.items()) + lignes / 200
    return {"ecran": os.path.basename(dossier), "note": round(note, 1), "lignes": lignes,
            "champs_lies": c["liaison"], "regles_sur_controle": c["regle_saisie"],
            "sql_en_dur": c["sql_dur"], "pilotage_affichage": c["affichage"],
            "validations_sur_champ": c["validation_ui"], "evenements": c["evenement"]}

lignes_csv = [r for r in (noter(os.path.join(RACINE, n)) for n in sorted(os.listdir(RACINE))
              if n.startswith("PROC_") and os.path.isdir(os.path.join(RACINE, n))) if r]
lignes_csv.sort(key=lambda r: r["note"])
with open(SORTIE, "w", newline="", encoding="utf-8") as fh:
    ecrivain = csv.DictWriter(fh, fieldnames=list(lignes_csv[0].keys()), delimiter=";")
    ecrivain.writeheader()
    ecrivain.writerows(lignes_csv)

# Un ecran SANS champ lie n est pas un ecran de saisie : coquille, liste ou outil interne.
reels = [r for r in lignes_csv if r["champs_lies"] >= 5 and not r["ecran"].endswith("_EXE")]
print(f"ecrans analyses : {len(lignes_csv)} | vrais ecrans de saisie : {len(reels)}")
print(f"note mediane des vrais ecrans : {statistics.median([r['note'] for r in reels]):.1f}")
print(f"\n20 plus faciles :")
for r in reels[:20]:
    print(f"  {r['ecran']:28} note={r['note']:>6}  champs={r['champs_lies']:>3}  "
          f"regles={r['regles_sur_controle']:>3}  sql={r['sql_en_dur']:>3}  affichage={r['pilotage_affichage']:>3}")
print(f"\ncsv complet : {SORTIE}")
