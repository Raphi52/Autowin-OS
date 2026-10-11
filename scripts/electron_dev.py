"""L'EXE DE DEV d'Autowin OS : un Electron a SON nom et a SON icone, sans toucher a node_modules.

D'OU IL VIENT
-------------
2026-10-11 (conv-266). En dev, l'app tournait sur `node_modules/electron/dist/electron.exe`, et
Windows l'identifiait par CE chemin : le menu Demarrer l'appelait « Electron », le Gestionnaire des
taches montrait l'atome d'Electron, et toute instance lancee depuis ce meme exe (instances de test,
copies de travail d'agent) partageait son identite et reecrivait son raccourci. Une premiere
correction reecrivait l'icone DANS electron.exe d'npm ; l'utilisateur l'a jugee bidouille
(« c une bidouille ? ») et a choisi cette voie : un exe a part, que seul le lanceur utilise.

CE QUE C'EST
------------
`.autowin-data/electron-dev/electron.exe` : une copie d'`electron.exe` dont rcedit change l'icone (le
logo, `build/icon.ico`) et le nom de produit (« Autowin OS Dev »). Elle GARDE son nom de fichier :
voir `EXE`. Tous les AUTRES fichiers d'Electron
(DLL, .pak, locales) y sont des LIENS DURS vers ceux d'npm : aucun octet copie, instantane.
`launch_dev.py` le passe a `electron-vite dev` par `ELECTRON_EXEC_PATH`, que electron-vite 5 lit pour
choisir l'exe qu'il lance ET relance (rechargement du processus principal) : le hot reload ne change
pas. Seul le lanceur s'en sert : instances de test et copies d'agent gardent l'Electron d'npm.

Le NOM DE PRODUIT compte : Electron nomme son raccourci du menu Demarrer d'apres lui
(`GetApplicationName`, windows_toast_activator.cc) — preuve sur ce poste : l'app appelle
`app.setName("Autowin OS")` et son raccourci s'appelle pourtant `Electron.lnk` —, et le Gestionnaire
des taches affiche la description du fichier. `src/main/raccourci-demarrer-dev.ts` reconnait l'exe de
dev a son DOSSIER (`electron-dev`) et nomme le raccourci « Autowin OS Dev.lnk ».

LES LIENS DURS ONT UN PRIX, ASSUME : quand l'app tourne sur l'exe de dev, elle tient les DLL d'npm
(c'est le meme fichier). Les garde-fous qui refusent un `npm install` app ouverte doivent donc tester
l'exe de dev aussi : `executables_a_surveiller` est leur liste unique.

JAMAIS BLOQUANT : au moindre echec, `preparer` rend None et le lanceur demarre sur l'Electron d'npm,
comme avant. Un exe TENU (les relais de fond tournent dessus et survivent aux redemarrages) est
RENOMME dans `.ancien/` — Windows l'autorise sur un exe en cours —, et supprime des qu'il est libre.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

NOM = "Autowin OS Dev"
# L'exe s'appelle TOUJOURS `electron.exe` : Electron calcule `app.isPackaged` sur ce seul nom
# (`basename(execPath) != "electron.exe"`, PR electron#12656 puis #29464). Mesure du 2026-10-11 :
# renomme `Autowin OS Dev.exe`, l'app se croyait installee, `is.dev` tombait a faux et la fenetre
# chargeait `out/renderer` au lieu du serveur de dev — le hot reload de l'interface etait perdu.
# C'est le DOSSIER qui distingue l'exe de dev (et donc son identite Windows, son chemin).
EXE = "electron.exe"
TAMPON = "autowin-dev.json"
# Reliquats de l'ancienne retouche de node_modules (conv-266, avant cet exe) : retires au passage.
_RELIQUATS = ("autowin-icone.json",)
_RELIQUATS_EXE = "electron-atome-*.exe"


def dossier_dev(racine: Path) -> Path:
    return racine / ".autowin-data" / "electron-dev"


def exe_dev(racine: Path) -> Path:
    return dossier_dev(racine) / EXE


def _dist(racine: Path) -> Path:
    return racine / "node_modules" / "electron" / "dist"


def executables_a_surveiller(racine: Path) -> list[Path]:
    """Exe qui, s'ils sont TENUS, signifient qu'un Electron tourne sur les fichiers de node_modules.

    Liste UNIQUE des garde-fous de `npm install` (launch_dev_dependances.py, garde-npm-modules.mjs
    en reprend le chemin) : l'Electron d'npm, ses anciens exe mis de cote, l'exe de dev et les siens.
    """
    dist = _dist(racine)
    ancien = dossier_dev(racine) / ".ancien"
    return [
        dist / "electron.exe",
        *sorted(dist.glob(_RELIQUATS_EXE)),
        exe_dev(racine),
        *sorted(ancien.glob("*.exe")),
    ]


def _tenu(chemin: Path) -> bool:
    """Vrai si le fichier ne s'ouvre pas en ecriture : un processus l'utilise. L'ouverture ne modifie rien."""
    try:
        with chemin.open("r+b"):
            return False
    except FileNotFoundError:
        return False
    except OSError:
        return True


def _supprimer_si_libre(chemin: Path) -> None:
    try:
        chemin.unlink()
    except OSError:
        pass  # encore tenu par un processus lance avant : le passage suivant s'en charge


def _mettre_de_cote(chemin: Path, cible: Path) -> None:
    """Renomme un fichier TENU dans `.ancien/` : ses processus continuent dessus, la place est libre."""
    ancien = cible / ".ancien"
    ancien.mkdir(parents=True, exist_ok=True)
    os.rename(chemin, ancien / f"{time.time_ns()}-{chemin.name}")


def _liberer(dest: Path, cible: Path, tenu) -> None:
    """Libere `dest` (supprime, ou met de cote s'il est tenu) avant d'y poser un nouveau fichier."""
    if dest.exists():
        if tenu(dest):
            _mettre_de_cote(dest, cible)
        else:
            dest.unlink()


def _attendu(racine: Path) -> dict:
    dist = _dist(racine)
    etat = (dist / "electron.exe").stat()
    try:
        version = (dist / "version").read_text(encoding="utf-8").strip()
    except OSError:
        version = ""
    icone = racine / "build" / "icon.ico"
    return {
        "electron": {"version": version, "taille": etat.st_size, "mtime_ns": etat.st_mtime_ns},
        "ico_sha256": hashlib.sha256(icone.read_bytes()).hexdigest(),
        "nom": NOM,
    }


def preparer(racine: Path, executer=None, tenu=_tenu, lier=os.link) -> tuple[Path | None, str]:
    """Construit ou rafraichit l'exe de dev. Rend (son chemin, etat), ou (None, raison).

    Etats : « pret » (rien a faire), « prepare » (construit ou rafraichi), « absent : … »,
    « echec : … ». Mesure (245 Mo, disque mecanique, conv-266) : quelques secondes une fois par
    Electron ou par logo, instantane ensuite.
    """
    executer = executer or subprocess.run
    dist = _dist(racine)
    cible = dossier_dev(racine)
    exe = exe_dev(racine)
    source = dist / "electron.exe"
    icone = racine / "build" / "icon.ico"
    outil = racine / "node_modules" / "electron-winstaller" / "vendor" / "rcedit.exe"

    for reliquat in (*(dist / n for n in _RELIQUATS), *dist.glob(_RELIQUATS_EXE)):
        if reliquat.exists():
            _supprimer_si_libre(reliquat)
    for ancien in (cible / ".ancien").glob("*"):
        _supprimer_si_libre(ancien)

    if not source.is_file():
        return None, f"absent : Electron d'npm introuvable ({source})"
    if not icone.is_file():
        return None, f"echec : icone introuvable ({icone})"
    attendu = _attendu(racine)
    tampon = cible / TAMPON
    try:
        actuel = json.loads(tampon.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        actuel = {}
    if actuel == attendu and exe.is_file():
        return exe, "pret"
    if not outil.is_file():
        return None, f"echec : rcedit introuvable ({outil})"

    neuf = cible / f"{NOM}.neuf.exe"
    options: dict = {"capture_output": True, "text": True, "timeout": 120}
    if sys.platform == "win32":
        options["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    try:
        cible.mkdir(parents=True, exist_ok=True)
        if tampon.exists():
            tampon.unlink()  # un passage interrompu ne doit jamais passer pour « pret »
        # 1. Les fichiers d'Electron, sauf l'exe : liens durs vers ceux d'npm.
        for fichier in sorted(p for p in dist.rglob("*") if p.is_file()):
            relatif = fichier.relative_to(dist)
            nom = relatif.name
            if relatif == Path("electron.exe") or nom in _RELIQUATS or Path(nom).match(_RELIQUATS_EXE):
                continue
            dest = cible / relatif
            if dest.exists() and dest.samefile(fichier):
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            _liberer(dest, cible, tenu)
            try:
                lier(fichier, dest)
            except OSError:
                shutil.copy2(fichier, dest)  # autre volume : une copie fait le meme travail
        # 2. L'exe : copie, icone et nom poses par rcedit, essai, puis seulement en place.
        shutil.copy2(source, neuf)
        fin = executer(
            [str(outil), str(neuf), "--set-icon", str(icone),
             "--set-version-string", "FileDescription", NOM,
             "--set-version-string", "ProductName", NOM],
            **options,
        )
        if fin.returncode != 0:
            return None, f"echec : rcedit code {fin.returncode} {(fin.stderr or '').strip()[:200]}"
        env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
        env["ELECTRON_RUN_AS_NODE"] = "1"
        essai = executer([str(neuf), "-e", "process.exit(0)"], env=env, **options)
        if essai.returncode != 0:
            return None, f"echec : l'exe de dev ne demarre pas (code {essai.returncode})"
        _liberer(exe, cible, tenu)
        os.replace(neuf, exe)
    except (OSError, subprocess.SubprocessError) as erreur:
        return None, f"echec : {erreur}"
    finally:
        if neuf.exists():
            _supprimer_si_libre(neuf)
    tampon.write_text(json.dumps(attendu), encoding="utf-8")
    return exe, "prepare"


if __name__ == "__main__":
    racine = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    chemin, etat = preparer(racine)
    print(f"exe de dev : {etat}{f' -> {chemin}' if chemin else ''}")
    sys.exit(0 if chemin else 1)
