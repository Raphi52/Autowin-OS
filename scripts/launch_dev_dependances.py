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
import time
from collections.abc import Callable
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

    Compte AUSSI l'EXE DE DEV et les anciens exe mis de cote (conv-266) : l'app lancee par le lanceur
    tourne sur `Autowin OS Dev.exe`, dont les DLL sont des liens durs vers celles d'npm, et elle
    charge ses modules natifs depuis node_modules — electron.exe d'npm peut alors etre LIBRE alors
    qu'une reinstallation buterait en EBUSY. Liste unique : `electron_dev.executables_a_surveiller`.
    """
    from electron_dev import executables_a_surveiller

    for exe in executables_a_surveiller(racine):
        try:
            with exe.open("r+b"):
                pass
        except FileNotFoundError:
            continue
        except OSError:
            return True
    return False


def attendre_electron_libre(
    racine: Path,
    delai_s: float = 20.0,
    pause_s: float = 0.5,
    *,
    dormir: Callable[[float], None] = time.sleep,
    horloge: Callable[[], float] = time.monotonic,
    signe_de_vie: Callable[[], None] | None = None,
) -> bool:
    """Vrai des que plus aucun Electron ne tient `node_modules` ; Faux s'il est encore tenu apres `delai_s`.

    LA COURSE DU REDEMARRAGE, mesuree le 2026-10-12 (conv-900) : `restart_app` (app-restart.ts) lance
    le lanceur PUIS quitte l'app. Le lanceur a teste le verrou a 09:19:46, les trois processus de
    l'ancienne app sont morts a 09:19:47 (app-exits.log, « arret propre ») : la reparation a ete
    sautee pour UNE seconde, et Electron 44 n'a jamais ete pose. On attend donc que l'ancienne app
    finisse de quitter. Une app qui tourne VRAIMENT ne lache rien : au bout du delai, Faux, et la
    reparation reste sautee comme avant -- jamais d'`npm install` sous EBUSY.
    """
    limite = horloge() + delai_s
    while electron_verrouille(racine):
        if horloge() >= limite:
            return False
        if signe_de_vie is not None:
            signe_de_vie()
        dormir(pause_s)
    return True
