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

UNE exception : la version d'Electron (`MOTEUR`). Monter son correctif (44.5.1 -> 44.11.3, les
correctifs de securite de Chromium) n'ajoute ni ne retire aucun paquet : sans cette comparaison, le
lock change et l'app de ce poste continue de tourner sur l'ancien moteur, puisqu'une
reinstallation app ouverte est refusee (scripts/garde-npm-modules.mjs). Le faux positif reste
borne : `npm install --no-save` pose exactement la version du lock, l'ecart se referme au premier
lancement.
"""

from __future__ import annotations

import json
import socket
import time
from collections.abc import Callable
from pathlib import Path

MOTEUR = "node_modules/electron"


def _ecart_du_moteur(racine: Path, attendue: object) -> str | None:
    """`node_modules/electron@<lock> (installe : <disque>)` si les deux versions se lisent et different."""
    try:
        installee = json.loads((racine / MOTEUR / "package.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        return None
    if not isinstance(attendue, str) or not isinstance(installee, str) or installee == attendue:
        return None
    return f"{MOTEUR}@{attendue} (installe : {installee})"


def dependances_manquantes(racine: Path, limite: int = 10) -> list[str]:
    """Jusqu'a `limite` elements manquants de `node_modules`, selon `package-lock.json`.

    Lock illisible -> [] : on ne repare pas sur une reference qu'on ne sait pas lire. De meme pour
    la version d'Electron : illisible d'un cote ou de l'autre, elle n'est pas comparee.
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
            if len(manquants) >= limite:
                break
            continue
        if chemin == MOTEUR and (ecart := _ecart_du_moteur(racine, info.get("version"))):
            manquants.append(ecart)
        if chemin.count("node_modules/") == 1:
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


# Le port du serveur de l'interface en dev : celui de Vite par defaut (electron.vite.config.ts n'en
# fixe aucun). L'ORIGINE de la vue en depend (`http://localhost:5173`), donc toute sa memoire locale.
PORT_INTERFACE_DEV = 5173

# Plafond d'attente d'une ancienne app QUI QUITTE ENCORE. Mesure dans app-exits.log : entre la
# demande de fermeture et la mort du dernier processus, 38 s le 2026-11-12, jusqu'a 76 s le
# 2026-11-02. Au-dela, on la tient pour figee : lancer quand meme vaut mieux que pas de fenetre.
DELAI_FERMETURE_ANCIENNE_APP_S = 120.0


def port_occupe(port: int, delai_s: float = 0.3) -> bool:
    """Vrai si un serveur ecoute deja sur `port` en local, en IPv4 ou en IPv6 (Vite ecoute sur
    « localhost », qui peut etre l'un ou l'autre). Une simple connexion, refermee aussitot."""
    for hote in ("127.0.0.1", "::1"):
        famille = socket.AF_INET6 if ":" in hote else socket.AF_INET
        try:
            with socket.socket(famille, socket.SOCK_STREAM) as s:
                s.settimeout(delai_s)
                if s.connect_ex((hote, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def attendre_port_libre(
    port: int = PORT_INTERFACE_DEV,
    delai_s: float = 20.0,
    pause_s: float = 0.5,
    *,
    ancienne_app_vivante: Callable[[], bool] = lambda: False,
    delai_ancienne_app_s: float = DELAI_FERMETURE_ANCIENNE_APP_S,
    occupe: Callable[[int], bool] = port_occupe,
    dormir: Callable[[float], None] = time.sleep,
    horloge: Callable[[], float] = time.monotonic,
    signe_de_vie: Callable[[], None] | None = None,
) -> bool:
    """Vrai des que `port` est libre ; Faux s'il est encore pris apres le delai qui s'applique.

    LA MEME COURSE DU REDEMARRAGE que `attendre_electron_libre`, sur le port de l'interface : le
    lanceur demarre pendant que l'ancienne app quitte, et son serveur Vite tient encore 5173. Le
    nouveau Vite ecrit « Port 5173 is in use, trying another one » et prend 5174 : la vue change
    d'ORIGINE, donc de memoire locale (dossiers retires du Chat, langue, zoom, etats du Board, fils
    deja vus). Pire, les deux Electron partagent alors le meme profil : le 2026-11-12, le nouveau a
    trouve la base « Local Storage » tenue par l'ancien et l'a recreee vide.

    Deux delais, parce que deux causes : tant que `ancienne_app_vivante()` (notre Electron tourne
    encore), elle est en train de quitter et on l'attend jusqu'a `delai_ancienne_app_s` — elle met
    couramment 30 a 80 s. Une fois partie, un port encore pris l'est par un TIERS qui ne le lachera
    pas : au bout de `delai_s`, Faux, et Vite prendra le suivant (l'appelant le journalise).
    """
    debut = horloge()
    while occupe(port):
        plafond = delai_ancienne_app_s if ancienne_app_vivante() else delai_s
        if horloge() - debut >= plafond:
            return False
        if signe_de_vie is not None:
            signe_de_vie()
        dormir(pause_s)
    return True
