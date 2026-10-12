"""Les COMPTES Claude, vus depuis le lanceur : les lire, les nommer, basculer le compte actif.

POURQUOI LE LANCEUR LES MONTRE
------------------------------
Pied « 6.3 · deux comptes » choisi sur maquette (conv-903, 2026-10-12, /draft en six tours) : le
compte actif dans une capsule au degrade Holo, l'autre compte a cote, en sombre. Un clic sur l'autre
compte le rend actif AVANT que l'application ne demarre.

LA SOURCE : le fichier de l'APPLICATION, jamais une copie
---------------------------------------------------------
`ClaudeAccountsStore` (src/main/claude-accounts.ts) persiste ses comptes dans
`.autowin-data/autowin-os/claude-accounts.json` (racine portable du profil DEV, cf. app-data.ts).
Le lanceur relit CE fichier et ne garde rien de son cote : une seconde liste divergerait.

QUAND LA BASCULE EST PERMISE — et pourquoi elle se verrouille
-------------------------------------------------------------
Le store lit le fichier UNE SEULE FOIS, dans son constructeur (`this.state = this.load()`), cree
des l'evaluation du process principal (src/main/index.ts, `new ClaudeAccountsStore`). Apres, il
garde l'etat en memoire et le REECRIT a chaque changement. Une bascule ecrite par le lanceur une fois
le process principal lance serait donc ignoree, puis ecrasee : un faux succes. Elle n'est permise
que tant qu'aucune ligne n'a montre Electron en train de partir (`ligne_verrouille_bascule`).

NOMS AFFICHES : ceux de la maquette validee
-------------------------------------------
Actif : « Amitel · team » en gras, l'adresse dessous. Autre : « gmail.com » en gras, « max » dessous.
L'organisation n'est reprise que si elle NOMME quelque chose : « x@y's Organization » est le nom
generique que Claude donne aux comptes personnels, il est remplace par le domaine de l'adresse.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
FICHIER_COMPTES = RACINE / ".autowin-data" / "autowin-os" / "claude-accounts.json"
COMPTE_PAR_DEFAUT = "default"  # DEFAULT_ACCOUNT_ID de claude-accounts.ts

# Electron part, ou le process principal publie deja ses jalons : le store a lu le fichier.
# « starting electron app » est ecrit par electron-vite AVANT le lancement d'Electron, c'est le
# dernier moment sur ; les jalons `[demarrage] N ms` viennent de l'application elle-meme. Les lignes
# que le lanceur pousse lui-meme (`[demarrage] mise a jour : ...`) n'ont pas de « N ms » : elles ne
# verrouillent rien.
_ELECTRON_PART = re.compile(
    r"starting electron app|DevTools listening on|\[demarrage\]\s+\d+\s*ms", re.IGNORECASE
)


@dataclass(frozen=True)
class Compte:
    id: str
    email: str = ""
    niveau: str = ""
    organisation: str = ""
    etiquette: str = ""


def lire_comptes(chemin: Path = FICHIER_COMPTES) -> tuple[list[Compte], str | None]:
    """Les comptes et l'id actif. Fichier absent ou illisible : `([], None)` — le pied se cache,
    le lanceur ne s'arrete pas pour un compte."""
    try:
        brut = json.loads(chemin.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], None
    if not isinstance(brut, dict) or not isinstance(brut.get("accounts"), list):
        return [], None
    comptes = [
        Compte(
            id=str(c["id"]),
            email=str(c.get("email") or "").strip(),
            niveau=str(c.get("subscriptionType") or "").strip(),
            organisation=str(c.get("orgName") or "").strip(),
            etiquette=str(c.get("label") or "").strip(),
        )
        for c in brut["accounts"]
        if isinstance(c, dict) and isinstance(c.get("id"), str) and c["id"]
    ]
    actif = brut.get("activeId")
    if not any(c.id == actif for c in comptes):
        actif = comptes[0].id if comptes else None
    return comptes, actif


def nom_court(compte: Compte) -> str:
    """« Amitel », « gmail.com » : ce qui distingue un compte en un mot."""
    if compte.etiquette:
        return compte.etiquette
    if compte.organisation and not compte.organisation.endswith("'s Organization"):
        return compte.organisation
    if "@" in compte.email:
        return compte.email.split("@", 1)[1]
    return "Compte par défaut" if compte.id == COMPTE_PAR_DEFAUT else compte.id


def titre_actif(compte: Compte) -> str:
    """Ligne en gras du compte actif : « Amitel · team »."""
    return f"{nom_court(compte)} · {compte.niveau}" if compte.niveau else nom_court(compte)


def initiales(compte: Compte) -> str:
    """« RV » pour raphael.vilain@… ; deux lettres au plus, jamais vide."""
    source = compte.email.split("@", 1)[0] if compte.email else nom_court(compte)
    morceaux = [m for m in re.split(r"[.\-_\s]+", source) if m]
    if len(morceaux) >= 2:
        return (morceaux[0][0] + morceaux[1][0]).upper()
    return (source[:2] or "?").upper()


def autres_comptes(comptes: list[Compte], actif: str | None) -> list[Compte]:
    return [c for c in comptes if c.id != actif]


def ligne_verrouille_bascule(ligne: str) -> bool:
    """Vrai des que la ligne montre Electron en train de partir : la bascule ne serait plus lue."""
    return bool(_ELECTRON_PART.search(ligne))


def basculer(nouvel_id: str, chemin: Path = FICHIER_COMPTES) -> bool:
    """Rend `nouvel_id` actif dans le fichier de l'application. Faux si rien n'a ete ecrit.

    On ne change QUE `activeId` : le reste du fichier (dossiers, dates, comptes) est relu et
    reecrit tel quel. Ecriture complete (fichier temporaire puis remplacement) : une coupure au
    milieu laisse l'ancien fichier entier, jamais un JSON tronque que le store remplacerait par
    l'etat par defaut — ce qui ferait perdre tous les comptes ajoutes.
    """
    try:
        etat = json.loads(chemin.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    comptes = etat.get("accounts") if isinstance(etat, dict) else None
    if not isinstance(comptes, list) or not any(isinstance(c, dict) and c.get("id") == nouvel_id for c in comptes):
        return False
    etat["activeId"] = nouvel_id
    temporaire = chemin.with_name(chemin.name + ".lanceur.tmp")
    try:
        # Octets bruts : pas de traduction \n -> \r\n, le fichier garde les fins de ligne de l'app
        # (JSON.stringify(state, null, 2)).
        temporaire.write_bytes(json.dumps(etat, indent=2, ensure_ascii=False).encode("utf-8"))
        os.replace(temporaire, chemin)
    except OSError:
        try:
            temporaire.unlink()
        except OSError:
            pass
        return False
    return True
