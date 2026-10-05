"""Etat de `node_modules` au lancement : ce qui manque, et si on peut le reparer sans risque.

LA PANNE, vecue deux fois (2026-10-02 et 2026-10-05) : `node_modules` a moitie vide -- `.bin`
disparu, des dizaines de paquets absents. Le lanceur tournait alors `npm run dev`, recevait
« 'electron-vite' n'est pas reconnu », et finissait sur « bundle perime » sans rien reparer.
Cause prouvee le 2026-10-05 : un `npm install` lance PENDANT que l'app tournait, interrompu par EBUSY
(electron.exe verrouille). Une premiere disparition de `.bin` reste sans cause prouvee : d'ou une
reparation AU LANCEMENT, qui couvre aussi la cause inconnue, en plus du garde
(scripts/garde-npm-modules.mjs) qui empeche la cause connue.

La reference est `package-lock.json` : chaque paquet NON optionnel qu'il liste doit avoir son
`package.json` sur disque, et chaque executable declare par un paquet de premier niveau son
raccourci `.bin/<nom>.cmd`. Existence seulement, pas de comparaison de versions : un faux positif
coute une reinstallation (~1 min) a CHAQUE lancement.
"""

from __future__ import annotations

import json
from pathlib import Path


def dependances_manquantes(racine: Path, limite: int = 10) -> list[str]:
    """Jusqu'a `limite` elements manquants de `node_modules`, selon `package-lock.json`.

    Lock illisible -> [] : on ne repare pas sur une reference qu'on ne sait pas lire.
    """
    try:
        paquets = json.loads((racine / "package-lock.json").read_text(encoding="utf-8")).get("packages", {})
    except (OSError, ValueError):
        return []
    manquants: list[str] = []
    for chemin, info in paquets.items():
        if not chemin.startswith("node_modules/") or not isinstance(info, dict):
            continue
        if info.get("optional") or info.get("link"):
            continue
        if not (racine / chemin / "package.json").is_file():
            manquants.append(chemin)
        elif chemin.count("node_modules/") == 1:
            binaires = info.get("bin")
            noms = binaires.keys() if isinstance(binaires, dict) else []
            for nom in noms:
                if not (racine / "node_modules" / ".bin" / f"{nom}.cmd").is_file():
                    manquants.append(f"node_modules/.bin/{nom}")
        if len(manquants) >= limite:
            break
    return manquants


def electron_verrouille(racine: Path) -> bool:
    """Vrai si `electron.exe` du depot ne s'ouvre pas en ecriture : une app tourne encore dessus.

    C'est la condition exacte qui a fait echouer `npm install` en EBUSY. L'ouverture ne modifie rien.
    """
    exe = racine / "node_modules" / "electron" / "dist" / "electron.exe"
    try:
        with exe.open("r+b"):
            return False
    except FileNotFoundError:
        return False
    except OSError:
        return True
