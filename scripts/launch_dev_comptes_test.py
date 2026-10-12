"""Tests des comptes vus par le lanceur : lecture, noms de la maquette 6.3, bascule, verrou.

Lignes de journal VERBATIM de `.autowin-data/launch-dev.log` (lancement du 2026-10-12 09:51).
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launch_dev_comptes import (  # noqa: E402
    Compte,
    autres_comptes,
    basculer,
    initiales,
    ligne_verrouille_bascule,
    lire_comptes,
    nom_court,
    titre_actif,
)

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


# Forme exacte de ClaudeAccountsStore.persist() : JSON.stringify(state, null, 2). Donnees fictives.
ETAT = {
    "version": 1,
    "activeId": "default",
    "accounts": [
        {"id": "default", "addedAt": "2026-08-06T10:00:00.000Z", "email": "prenom.nom@exemple.fr",
         "subscriptionType": "team", "orgName": "Exemple"},
        {"id": "compte-3", "dir": "D:\\x\\compte-3", "addedAt": "2026-08-07T10:00:00.000Z",
         "email": "perso@gmail.com", "subscriptionType": "max", "orgName": "perso@gmail.com's Organization"},
    ],
}

with tempfile.TemporaryDirectory() as dossier:
    chemin = Path(dossier) / "claude-accounts.json"
    chemin.write_bytes(json.dumps(ETAT, indent=2).encode("utf-8"))

    comptes, actif = lire_comptes(chemin)
    verifie(len(comptes) == 2 and actif == "default", "les deux comptes et l'actif doivent etre lus")
    pro, perso = comptes
    # --- noms de la maquette validee : « Exemple · team » / « gmail.com » + « max » --------------
    verifie(titre_actif(pro) == "Exemple · team", f"titre du compte actif : {titre_actif(pro)!r}")
    verifie(nom_court(perso) == "gmail.com",
            "« x's Organization » est le nom generique de Claude : il cede la place au domaine")
    verifie(initiales(pro) == "PN", f"initiales tirees de l'adresse : {initiales(pro)!r}")
    verifie(nom_court(Compte(id="default")) == "Compte par défaut", "compte jamais sonde : nom lisible")
    verifie(nom_court(Compte(id="c", etiquette="Boulot", email="a@b.fr")) == "Boulot",
            "une etiquette posee par l'utilisateur prime")
    verifie([c.id for c in autres_comptes(comptes, actif)] == ["compte-3"], "l'autre compte, sans l'actif")

    # --- bascule : seul activeId change, le reste du fichier est intact -------------------------
    verifie(basculer("compte-3", chemin), "la bascule vers un compte existant doit reussir")
    relu = json.loads(chemin.read_text(encoding="utf-8"))
    verifie(relu["activeId"] == "compte-3", "le fichier doit porter le nouvel actif")
    verifie(relu["accounts"] == ETAT["accounts"] and relu["version"] == 1,
            "la bascule ne doit RIEN changer d'autre : dossiers, dates et comptes restent tels quels")
    verifie(b"\r\n" not in chemin.read_bytes(), "pas de traduction en CRLF : le fichier garde les fins de l'app")
    verifie(not list(Path(dossier).glob("*.tmp")), "aucun fichier temporaire ne doit rester")
    verifie(not basculer("inconnu", chemin), "un id absent ne doit rien ecrire")
    verifie(json.loads(chemin.read_text(encoding="utf-8"))["activeId"] == "compte-3",
            "un refus laisse le fichier intact")

    # --- fichier abime ou absent : le pied se cache, rien ne casse ------------------------------
    chemin.write_bytes(b"{ pas du json")
    verifie(lire_comptes(chemin) == ([], None), "un fichier illisible rend une liste vide, pas une exception")
    verifie(not basculer("default", chemin), "aucune bascule sur un fichier illisible")
    verifie(lire_comptes(Path(dossier) / "absent.json") == ([], None), "fichier absent : liste vide")

# --- verrou : des qu'Electron part, le store a lu le fichier --------------------------------------
verifie(not ligne_verrouille_bascule("\x1b[32m✓\x1b[39m 2143 modules transformed."), "compilation : bascule permise")
verifie(not ligne_verrouille_bascule("[demarrage] mise à jour : lecture de la référence distante"),
        "une ligne du LANCEUR (sans « N ms ») ne doit pas verrouiller")
verifie(ligne_verrouille_bascule("starting electron app..."), "electron-vite annonce Electron : verrou")
verifie(ligne_verrouille_bascule("[demarrage]      0 ms  module principal évalué"),
        "le process principal publie ses jalons : le store a deja lu le fichier")
verifie(ligne_verrouille_bascule("DevTools listening on ws://127.0.0.1:9224/devtools/browser/be55"),
        "DevTools : Electron tourne")

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS launch_dev_comptes")
