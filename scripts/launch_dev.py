"""Lanceur DEV d'Autowin OS — un seul script, en Python, jamais muet.

POURQUOI CE FICHIER REMPLACE UN DUO VBS + POWERSHELL
----------------------------------------------------
L'ancienne chaine etait `raccourci -> wscript.exe -> launch-dev.vbs -> powershell -> cmd -> npm`.
Le VBS n'existait que pour une raison technique : `powershell.exe` est une application CONSOLE, donc
Windows lui alloue une console que Windows Terminal AFFICHE malgre `-WindowStyle Hidden` (mesure du
2026-08-05 : fenetre visible 242 ms apres le double-clic). `wscript.exe` etant graphique, le probleme
disparaissait.

`pyw.exe` est graphique lui aussi : la raison d'etre du VBS tombe, et la chaine passe de cinq
maillons a deux.

LE DEFAUT QUE CE FICHIER CORRIGE, ET QUI N'ETAIT PAS UNE QUESTION DE LANGAGE
---------------------------------------------------------------------------
Le VBS lancait PowerShell avec `shell.Run commande, 0, False` — `False` voulant dire « ne pas
attendre ». Il ne recuperait donc JAMAIS le code de sortie. Quand `launch-dev.ps1` refusait de
demarrer (« Autowin OS Dev est deja lance ») ou quand la compilation echouait, il n'y avait ni
console, ni boite de dialogue, ni journal : le double-clic ne faisait rien, l'utilisateur restait
devant la fenetre precedente et concluait, a raison, « c'est perime ».

Trois garanties ici, dans cet ordre :
  1. AUCUN echec muet — toute sortie anormale produit une boite de dialogue ET une ligne de journal ;
  2. instance unique par un MUTEX nomme Windows, primitive exacte, au lieu d'une inspection de lignes
     de commande qui confond un `npm run dev` d'un autre depot ;
  3. GARDE DE FRAICHEUR — apres lancement, on VERIFIE que le bundle est devenu plus recent que les
     sources. S'il ne l'est pas, on le DIT : c'est la demande « demarrer perime ne devrait pas etre
     possible » rendue litterale.
"""

from __future__ import annotations

import ctypes
import hashlib
import os
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launch_dev_phases import decider_mise_a_jour, libelle_mise_a_jour
from launch_dev_splash import Splash  # noqa: E402 - le chemin doit etre pose avant l'import

RACINE = Path(__file__).resolve().parent.parent
JOURNAL = RACINE / ".autowin-data" / "launch-dev.log"
BUNDLE = RACINE / "out" / "main" / "index.js"

# Sources dont une modification doit rendre le bundle perime. `electron.vite.config.ts` en fait
# partie : changer la configuration de build sans changer une seule source rend le bundle faux aussi.
SOURCES = ("src",)
FICHIERS_SOURCES = ("package.json", "electron.vite.config.ts")

# Nom STABLE et porte sur le CHEMIN du depot : deux copies du projet doivent pouvoir tourner en
# parallele, alors qu'un mutex fixe interdirait la seconde sans raison.
#
# `hash()` a d'abord ete utilise ici, et c'etait un DEFAUT : Python randomise le hachage des chaines a
# chaque processus. Trois lancements donnaient trois noms differents — mesure : 8621494071428621407,
# 5273497174065802945, 8743382075885100538 — donc le verrou ne bloquait RIEN. Le 2026-08-12, DEUX
# alertes identiques se sont affichees cote a cote parce que deux instances tournaient ensemble.
# Un hachage cryptographique, lui, ne depend pas du processus.
_EMPREINTE = hashlib.sha1(str(RACINE).lower().encode("utf-8")).hexdigest()[:16]
MUTEX = "Local\\autowin-os-dev-" + _EMPREINTE

# On ne surveille PAS la duree totale : un demarrage long est normal — le test `startup-splash.test.ts`
# mesure « l'interface apparaissait vers 70-80 s », et un plafond de 90 s a produit une fausse alerte
# le 2026-08-12 a 17:32 alors que le bundle venait d'etre reecrit LA MEME MINUTE.
#
# On surveille le SILENCE : tant que la sortie parle, on attend. C'est un demarrage MUET qui est
# suspect, pas un demarrage lent.
SILENCE_MAX_S = 75
# Filet de dernier ressort, tres large : un processus qui ecrirait sans fin ne doit pas laisser cette
# fenetre ouverte indefiniment.
ATTENTE_TOTALE_S = 600
CREATE_NO_WINDOW = 0x08000000


def journaliser(message: str) -> None:
    """Ecrit une ligne datee. Best-effort : un journal indisponible ne doit pas empecher le lancement."""
    try:
        JOURNAL.parent.mkdir(parents=True, exist_ok=True)
        with JOURNAL.open("a", encoding="utf-8") as fichier:
            fichier.write(f"{datetime.now().isoformat(timespec='seconds')} {message}\n")
    except OSError:
        pass


def alerter(message: str, titre: str = "Autowin OS Dev") -> None:
    """Boite de dialogue. Sans console, c'est le SEUL canal que l'utilisateur puisse voir."""
    journaliser(f"ALERTE {message}")
    try:
        ctypes.windll.user32.MessageBoxW(None, message, titre, 0x10)  # MB_ICONERROR
    except Exception:  # noqa: BLE001 - une alerte qui echoue ne doit pas masquer la cause initiale
        print(message, file=sys.stderr)


def instance_unique() -> bool:
    """Vrai si CE processus detient le verrou. Le handle reste ouvert tant que le processus vit.

    Deux pieges ctypes, tous deux constates ici avant correction :
      - `restype` vaut `int` par defaut, soit 32 bits : un HANDLE 64 bits etait TRONQUE, et le
        `if not handle` jugeait sur une valeur mutilee ;
      - `windll.kernel32.GetLastError()` n'est pas fiable — un appel ctypes intermediaire peut avoir
        ecrase le code. Il faut `use_last_error=True` et `ctypes.get_last_error()`, lu immediatement.
    Symptome mesure : le PREMIER appel rendait `False`, donc un lancement legitime se croyait dedouble.
    """
    global _verrou  # noqa: PLW0603 - garder le handle vivant, sinon le mutex meurt aussitot
    noyau = ctypes.WinDLL("kernel32", use_last_error=True)
    noyau.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    noyau.CreateMutexW.restype = wintypes.HANDLE
    handle = noyau.CreateMutexW(None, False, MUTEX)
    erreur = ctypes.get_last_error()
    if not handle:
        # Verrou indisponible (droits, nom refuse) : mieux vaut LANCER que bloquer sur un detail
        # systeme — un lanceur qui refuse de lancer est pire qu'un doublon.
        journaliser(f"mutex indisponible (erreur {erreur}) — verrou desactive")
        return True
    _verrou = handle
    return erreur != 183  # ERROR_ALREADY_EXISTS


_verrou: int | None = None


# Titre de NOTRE fenetre d'attente : il ne doit pas etre confondu avec celle de l'application, sinon
# l'ecran se fermerait en se voyant lui-meme.
TITRE_SPLASH = "autowin-dev-amorce"


def fenetres_app() -> set[int]:
    """Handles des fenetres VISIBLES de l'application, hors la notre.

    Rend un ENSEMBLE, pas un booleen : c'est ce qui permet de comparer avant/apres. Une fenetre
    « Autowin OS » deja ouverte — instance precedente survivante — ferait sinon disparaitre l'ecran
    d'attente a la premiere seconde, exactement le symptome constate le 2026-08-12.

    Les lignes de log ne peuvent pas remplacer cette sonde : « restarting electron app » signifie
    qu'Electron REDEMARRE, et `[brain-launch]` / `[worktrees]` sont des traces du process principal,
    ecrites avant tout affichage. Mesure : l'etape « pret » etait atteinte en 3 s sur un ecran noir.
    """
    trouvees: set[int] = set()
    try:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        rappel = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows.argtypes = (rappel, wintypes.LPARAM)
        user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
        user32.IsWindowVisible.argtypes = (wintypes.HWND,)

        @rappel
        def visiter(hwnd: int, _: int) -> bool:
            if user32.IsWindowVisible(hwnd):
                tampon = ctypes.create_unicode_buffer(300)
                user32.GetWindowTextW(hwnd, tampon, 300)
                titre = tampon.value.strip()
                if "autowin" in titre.lower() and TITRE_SPLASH not in titre:
                    trouvees.add(int(hwnd))
            return True

        user32.EnumWindows(visiter, 0)
    except Exception:  # noqa: BLE001 - sonde best-effort : son echec ne doit pas bloquer le lanceur
        return set()
    return trouvees


def mtime_max(chemins: list[Path]) -> float:
    """Horodatage le plus recent, 0 si rien n'est lisible."""
    recent = 0.0
    for chemin in chemins:
        if chemin.is_file():
            recent = max(recent, chemin.stat().st_mtime)
        elif chemin.is_dir():
            for enfant in chemin.rglob("*"):
                if enfant.is_file():
                    recent = max(recent, enfant.stat().st_mtime)
    return recent


def sources_les_plus_recentes() -> float:
    return mtime_max(
        [RACINE / nom for nom in SOURCES] + [RACINE / nom for nom in FICHIERS_SOURCES]
    )


def npm() -> str | None:
    """Chemin de `npm.cmd`. Resolu ICI pour pouvoir DIRE qu'il manque, au lieu d'echouer plus loin."""
    for repertoire in os.environ.get("PATH", "").split(os.pathsep):
        candidat = Path(repertoire) / "npm.cmd"
        if candidat.is_file():
            return str(candidat)
    return None


def main() -> int:
    if not (RACINE / "package.json").is_file():
        alerter(f"Projet Autowin OS introuvable :\n{RACINE}")
        return 1

    if not instance_unique():
        # C'est le cas qui echouait EN SILENCE : l'utilisateur double-cliquait, rien ne se passait,
        # et la fenetre perimee restait a l'ecran comme si le lancement avait reussi.
        alerter(
            "Autowin OS Dev tourne déjà.\n\n"
            "La fenêtre affichée est celle de cette instance : elle ne s'est pas relancée, "
            "donc elle peut exécuter du code plus ancien que tes sources.\n\n"
            "Ferme-la avant de relancer.",
            "Autowin OS Dev — déjà lancé",
        )
        return 2

    deja_ouvertes = fenetres_app()
    if deja_ouvertes:
        # Le mutex ne suffit pas : il meurt avec le lanceur, alors que l'application lui survit. Sans
        # ce controle, un second `npm run dev` demarrait a cote du premier.
        alerter(
            "".join(
                [
                    "Une fenêtre Autowin OS est déjà ouverte.\n\n",
                    "Elle peut exécuter du code plus ancien que tes sources. ",
                    "Ferme-la avant de relancer, sinon deux instances travailleront en parallèle.",
                ]
            ),
            "Autowin OS Dev — déjà ouvert",
        )
        return 2

    commande = npm()
    if not commande:
        alerter("npm est introuvable dans le PATH : impossible de lancer le mode dev.")
        return 3

    avant = sources_les_plus_recentes()
    journaliser(f"lancement (sources={avant:.0f})")

    # L'ECRAN D'ABORD. Il s'ouvre avant que `npm` soit lance : c'est tout l'objet — une fenetre a la
    # seconde du double-clic, pas apres la compilation. Le reste du travail se fait dans un thread,
    # parce que tkinter exige de garder sa boucle sur le thread principal.
    splash = Splash(titre=TITRE_SPLASH)
    resultat: dict[str, int] = {}
    # Partage entre les deux threads : la LECTURE bloque sur `stdout`, elle ne peut donc pas constater
    # un silence. C'est un veilleur separe qui le fait.
    parole = {"dernier": time.monotonic()}

    def git(args: list[str], delai: int = 25) -> tuple[int, str]:
        """Appel git borne. Une panne git ne doit JAMAIS empecher un demarrage."""
        try:
            fin = subprocess.run(  # noqa: S603 - arguments fixes, cwd resolu
                ["git", *args],
                cwd=str(RACINE),
                capture_output=True,
                text=True,
                timeout=delai,
                check=False,
                creationflags=CREATE_NO_WINDOW,
            )
            return fin.returncode, (fin.stdout or "").strip()
        except Exception:  # noqa: BLE001 - git absent, lent ou hors depot : on continue sans
            return 1, ""

    def mettre_a_jour() -> None:
        """Rapatrie ce qui manque AVANT de construire — et refuse de le faire sur un arbre sale.

        Demande utilisateur : « ca devrait auto update en plus des le launcher ». Le refus sur arbre
        sale n'est pas une precaution decorative : le 2026-08-13, un `git pull --autostash` lance par
        une session concurrente a EFFACE de l'arbre partage un correctif non committe, verifie et
        vert, qu'il a fallu reecrire. Un lanceur qui stashe au double-clic le travail en cours de
        quelqu'un d'autre reproduirait ce degat a chaque demarrage.

        Chaque issue est ANNONCEE a l'ecran : un lanceur muet est exactement ce qui a fait croire
        pendant des jours qu'on lançait la derniere version.
        """
        splash.pousser("[demarrage] mise à jour : lecture de la référence distante\n")
        # `fetch` seul : il ne touche PAS a l'arbre de travail, donc il est sur meme sur un arbre sale.
        code_fetch, _ = git(["fetch", "origin", "main"], delai=40)
        if code_fetch != 0:
            splash.pousser("[demarrage] mise à jour : référence distante injoignable, on continue\n")
            journaliser("maj: fetch impossible")
            return
        _, brut = git(["rev-list", "--count", "HEAD..origin/main"])
        retard = int(brut) if brut.isdigit() else None
        _, porcelain = git(["status", "--porcelain"])
        non_committes = len([l for l in porcelain.splitlines() if l.strip()])
        decision = decider_mise_a_jour(retard, non_committes)
        libelle = libelle_mise_a_jour(decision, retard, non_committes)
        splash.pousser(f"[demarrage] {libelle}\n")
        journaliser(f"maj: {decision} (retard={retard}, non_committes={non_committes})")
        if decision != "appliquer":
            return
        # `--ff-only` : on AVANCE, on ne fusionne ni ne rebase. Sur un arbre propre en retard pur,
        # c'est sans perte possible ; tout autre cas a deja ete refuse au-dessus.
        code_pull, _ = git(["merge", "--ff-only", "origin/main"], delai=60)
        if code_pull == 0:
            splash.pousser("[demarrage] mise à jour appliquée\n")
            journaliser("maj: appliquee")
        else:
            splash.pousser("[demarrage] mise à jour refusée par git, on lance la version locale\n")
            journaliser("maj: merge ff-only refuse")

    def travailler() -> None:
        try:
            mettre_a_jour()
            JOURNAL.parent.mkdir(parents=True, exist_ok=True)
            with JOURNAL.open("a", encoding="utf-8") as sortie:
                processus = subprocess.Popen(  # noqa: S603 - chemin resolu, arguments fixes
                    [commande, "run", "dev"],
                    cwd=str(RACINE),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    creationflags=CREATE_NO_WINDOW,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                )
                limite_totale = time.monotonic() + ATTENTE_TOTALE_S
                # On lit la sortie LIGNE A LIGNE : elle alimente l'ecran ET le journal. Sans cette
                # lecture, le tube se remplit et `npm` finit par se bloquer dessus.
                #
                # La fraicheur du bundle est TRANSMISE, elle ne ferme rien : c'est `SuiviDemarrage`
                # qui decide, sur la preuve qu'une fenetre Electron existe. Confondre les deux fermait
                # l'ecran a la premiere ligne, puisqu'un bundle sortant d'un build est deja frais.
                depasse = False
                for ligne in processus.stdout or ():
                    sortie.write(ligne)
                    sortie.flush()
                    splash.bundle_frais(BUNDLE.is_file() and BUNDLE.stat().st_mtime >= avant)
                    splash.pousser(ligne)
                    if splash.suivi.fermer():
                        break
                    parole["dernier"] = time.monotonic()
                    if time.monotonic() > limite_totale:
                        depasse = True
                        break
                if processus.poll() not in (None, 0):
                    resultat["code"] = 5
                    resultat["detail"] = f"le mode dev s'est arrêté (code {processus.returncode})"
                    return
                splash.bundle_frais(BUNDLE.is_file() and BUNDLE.stat().st_mtime >= avant)
                code, detail = splash.suivi.verdict(depasse)
                resultat["code"] = code
                if detail:
                    resultat["detail"] = detail
                journaliser(f"verdict={code} etape={splash.suivi.etape} frais={splash.suivi.bundle_frais}")
        except OSError as erreur:
            resultat["code"] = 4
            resultat["detail"] = str(erreur)
        finally:
            # L'ecran se referme TOUJOURS, meme sur echec : une fenetre d'attente qui reste ouverte
            # apres une erreur ferait croire que le demarrage continue.
            splash.terminer()

    def veiller() -> None:
        """Constate le SILENCE. Un demarrage lent est normal ; un demarrage muet ne l'est pas."""
        while not splash.fini:
            time.sleep(2.0)  # sleep-ok: cadence de veille sur un processus externe
            splash.suivi.voir_fenetre(bool(fenetres_app() - deja_ouvertes))
            if splash.suivi.fermer():
                journaliser(f"fenetre application detectee — ecran d'attente retire (etape={splash.suivi.etape})")
                splash.terminer()
                return
            if time.monotonic() - parole["dernier"] > SILENCE_MAX_S:
                journaliser(
                    f"silence de plus de {SILENCE_MAX_S} s "
                    f"(etape={splash.suivi.etape}, lignes={splash.suivi.lignes_vues})"
                )
                resultat.setdefault("code", 6)
                splash.terminer()
                return

    ouvrier = threading.Thread(target=travailler, daemon=True)
    ouvrier.start()
    threading.Thread(target=veiller, daemon=True).start()
    splash.attendre()

    # COURSE CORRIGEE (mesuree le 2026-08-12 a 17:46:08) : `attendre()` rend la main des que la
    # fenetre se ferme — donc des que l'application s'affiche, ce qui est le SUCCES. Mais le thread de
    # travail n'avait pas encore ecrit son verdict, et un defaut a 6 alertait « bundle perime » sur un
    # demarrage reussi. Le journal montrait l'absurdite : « ALERTE » puis « verdict=0 » la meme seconde.
    #
    # Deux corrections : on ATTEND brievement l'ouvrier, et le defaut n'est plus un echec arbitraire —
    # il vient de ce que le SUIVI a observe.
    ouvrier.join(timeout=5.0)
    defaut = 0 if splash.suivi.app_affichee else 6
    code = resultat.get("code", defaut)
    if code == 0:
        return 0
    if code == 7:
        alerter(
            "".join(
                [
                    f"{resultat.get('detail', 'compilation en échec')}.",
                    chr(10) + chr(10),
                    "L'application n'a pas pu être recompilée : elle tournerait sur du code plus ",
                    "ancien que tes sources.",
                    chr(10) + chr(10),
                    f"Journal :{chr(10)}{JOURNAL}",
                ]
            ),
            "Autowin OS Dev — compilation en échec",
        )
        return 7
    if code == 6:
        alerter(
            "".join(
                [
                    "Le bundle n'a pas été reconstruit dans le délai imparti.\n\n",
                    "L'application tournerait sur du code PLUS ANCIEN que tes sources — ",
                    "c'est exactement ce qu'il ne faut pas.\n\n",
                    f"Regarde la fin du journal :\n{JOURNAL}",
                ]
            ),
            "Autowin OS Dev — bundle périmé",
        )
        return 6
    detail = resultat.get("detail", "lancement impossible")
    alerter(f"{detail}\n\nJournal :\n{JOURNAL}")
    return code


if __name__ == "__main__":
    sys.exit(main())
