"""L'ENREGISTREUR DOIT NOMMER LA MORT : un code de sortie et une heure, pas une hypothese.

Le 2026-08-17, Autowin OS est mort deux fois SANS laisser de trace exploitable : aucune exception dans
`crash.log` a l'heure de la mort, aucun minidump, aucun rapport WER, l'agent en cours termine en
exit 0. Personne n'attendait le processus : le lanceur quitte des que la fenetre apparait, donc plus
aucun parent n'etait la pour recolter son code de sortie. Sans ce chiffre, toute cause avancee est une
supposition — j'en ai avance une, la mesure l'a en partie contredite.

Ce test exerce le coeur de l'enregistreur sur de VRAIS processus, avec de VRAIS codes de sortie.

Usage : py -3 scripts/enregistreur_sortie_test.py
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enregistreur_sortie import attendre_et_journaliser  # noqa: E402

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


def enfant_qui_sort_avec(code: int) -> subprocess.Popen[bytes]:
    return subprocess.Popen([sys.executable, "-c", f"import sys; sys.exit({code})"])


with tempfile.TemporaryDirectory() as racine:
    journal = Path(racine) / "app-exits.log"

    # 1. Un code d'erreur doit etre RECOLTE, pas perdu.
    processus = enfant_qui_sort_avec(7)
    verifie(
        attendre_et_journaliser(processus.pid, journal, etiquette="app", limite_s=30) is True,
        "l'enregistreur doit constater la mort d'un processus qu'il surveille",
    )
    ligne = journal.read_text(encoding="utf-8").strip().splitlines()[-1]
    verifie("code=7" in ligne, f"le code de sortie doit etre journalise tel quel (lu : {ligne})")
    verifie("app" in ligne, f"l'etiquette doit dire QUI est mort (lu : {ligne})")
    verifie(
        re.search(r"20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d", ligne) is not None,
        f"l'heure doit etre horodatee, sinon on ne recoupe rien (lu : {ligne})",
    )
    processus.wait(timeout=10)

    # 2. Une sortie NORMALE se journalise aussi : « code=0 » distingue un arret propre d'un kill.
    propre = enfant_qui_sort_avec(0)
    attendre_et_journaliser(propre.pid, journal, etiquette="app", limite_s=30)
    verifie(
        "code=0" in journal.read_text(encoding="utf-8").strip().splitlines()[-1],
        "un arret propre doit etre distinguable d'une mort violente",
    )
    propre.wait(timeout=10)

    # 3. Un PID inconnu ne fait pas tomber l'enregistreur : il le dit et rend la main.
    verifie(
        attendre_et_journaliser(999_999_999, journal, etiquette="app", limite_s=5) is False,
        "un PID introuvable doit rendre False, pas lever",
    )

# CABLAGE : un enregistreur que personne ne lance ne mesure rien.
LANCEUR = (Path(__file__).resolve().parent / "launch_dev.py").read_text(encoding="utf-8")
verifie("enregistreur_sortie" in LANCEUR, "le lanceur doit demarrer l'enregistreur")
verifie(
    "processus.pid" in LANCEUR,
    "l'enregistreur doit recevoir le PID du processus reellement lance",
)

if ECHECS:
    print(f"ECHEC ({len(ECHECS)}) :")
    for echec in ECHECS:
        print(" -", echec)
    raise SystemExit(1)
print("OK — la mort de l'app laisse desormais un code et une heure")
