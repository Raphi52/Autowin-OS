"""L'APP DOIT SURVIVRE A LA MORT DE SON LANCEUR.

MESURE le 2026-08-17. Autowin OS mourait sans laisser AUCUNE exception : rien dans `crash.log` a
l'heure de la mort, aucun minidump, l'agent en cours termine en exit 0. La cause est dans le lanceur :
il donne un TUBE (`subprocess.PIPE`) a `npm run dev`, lit ses lignes pour l'ecran d'attente, puis
ARRETE de lire des que la fenetre apparait (`if splash.suivi.fermer(): break`) et quitte. L'app ecrit
alors dans un tube dont le lecteur est mort.

Reproduit en isolation le meme jour : un enfant bavard branche sur un tube abandonne meurt apres
93 lignes sur `OSError` a l'ecriture — ce que Node rapporte `write EPIPE`, signature de 66 des
72 entrees de `crash.log`.

Ce test exerce la PLOMBERIE du lanceur, pas un modele : il lance un enfant bavard comme le lanceur
lance l'app, arrete de le lire, et exige que l'enfant ait continue a ecrire et fini proprement.

Usage : py -3 scripts/launch_dev_stdout_test.py
"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launch_dev import demarrer_dev, suivre_sortie  # noqa: E402

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


LIGNES = 3000
BAVARD = (
    "import sys\n"
    f"for i in range({LIGNES}):\n"
    "    sys.stdout.write(f'ligne {i} ' + 'x'*120 + '\\n')\n"
    "    sys.stdout.flush()\n"
)

with tempfile.TemporaryDirectory() as racine:
    dossier = Path(racine)
    enfant = dossier / "bavard.py"
    enfant.write_text(BAVARD, encoding="utf-8")
    sortie = dossier / "sortie-app.log"

    processus = demarrer_dev([sys.executable, str(enfant)], dossier, sortie)

    # On lit quelques lignes pour l'ecran d'attente, puis on ARRETE — exactement ce que fait le
    # lanceur quand il voit la fenetre.
    lues = 0
    for _ligne in suivre_sortie(sortie, limite_s=20.0):
        lues += 1
        if lues >= 5:
            break
    verifie(lues >= 5, "l'ecran d'attente doit pouvoir lire les premieres lignes")

    # Le lecteur est parti. L'enfant, lui, doit continuer sa vie.
    code = processus.wait(timeout=60)
    verifie(code == 0, f"l'app doit finir proprement apres le depart du lecteur (code {code})")
    ecrites = sum(1 for _ in sortie.open(encoding="utf-8", errors="replace"))
    verifie(
        ecrites >= LIGNES,
        f"l'app doit avoir ecrit ses {LIGNES} lignes, pas mourir sur un tube mort (vu {ecrites})",
    )

# CABLAGE : la plomberie ne sert a rien si le lanceur retombe sur un tube. C'est le seul defaut de la
# famille « expose mais jamais appele » qu'aucun test de comportement n'attrape.
SOURCE = (Path(__file__).resolve().parent / "launch_dev.py").read_text(encoding="utf-8")
_bloc = SOURCE[SOURCE.index("def travailler()") :]
verifie("demarrer_dev([commande" in _bloc, "le lanceur doit passer par `demarrer_dev`")
verifie("suivre_sortie(SORTIE_APP" in _bloc, "l'ecran d'attente doit SUIVRE le fichier de l'app")
verifie(
    "subprocess.PIPE" not in _bloc,
    "aucun tube pour l'app : son lecteur meurt avec le lanceur et l'app meurt avec lui",
)

if ECHECS:
    print(f"ECHEC ({len(ECHECS)}) :")
    for echec in ECHECS:
        print(" -", echec)
    raise SystemExit(1)
print("OK — l'app survit au depart de son lanceur")
