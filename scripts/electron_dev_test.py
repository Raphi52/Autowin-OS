"""Tests de l'exe de dev (`electron_dev.py`) : construit, rafraichi, jamais casse.

Lance par `npm run test:electron-dev` (py -3 scripts/electron_dev_test.py).
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import electron_dev as dev  # noqa: E402

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


class Fin:
    def __init__(self, code: int) -> None:
        self.returncode = code
        self.stdout = self.stderr = ""


def depot(dossier: Path) -> Path:
    """Un faux depot : dist d'Electron (avec un sous-dossier), icone du paquet, rcedit."""
    racine = dossier / "depot"
    dist = racine / "node_modules" / "electron" / "dist"
    (dist / "locales").mkdir(parents=True)
    (dist / "electron.exe").write_bytes(b"EXE-ATOME")
    (dist / "ffmpeg.dll").write_bytes(b"DLL")
    (dist / "locales" / "fr.pak").write_bytes(b"PAK")
    (dist / "version").write_text("44.5.1", encoding="utf-8")
    (racine / "build").mkdir()
    (racine / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU")
    outil = racine / "node_modules" / "electron-winstaller" / "vendor" / "rcedit.exe"
    outil.parent.mkdir(parents=True)
    outil.write_bytes(b"")
    return racine


appels: list[list[str]] = []


def simule(commande: list[str], **options: object) -> Fin:
    appels.append([str(c) for c in commande])
    if Path(commande[0]).name == "rcedit.exe":
        cible = Path(commande[1])
        cible.write_bytes(cible.read_bytes().replace(b"ATOME", b"ANNEAU"))
    else:
        env = options.get("env") or {}
        verifie(env.get("ELECTRON_RUN_AS_NODE") == "1", "l'essai de l'exe se fait en mode Node, sans fenetre")
        verifie("NODE_OPTIONS" not in env, "l'essai ne recoit pas NODE_OPTIONS (boite d'erreur sur l'ecran reel)")
    return Fin(0)


with tempfile.TemporaryDirectory() as dossier:
    racine = depot(Path(dossier))
    dist = racine / "node_modules" / "electron" / "dist"
    exe = dev.exe_dev(racine)
    verifie(exe == racine / ".autowin-data" / "electron-dev" / "electron.exe",
            f"l'exe de dev vit hors de node_modules, dans SON dossier : {exe}")
    # Renomme, il faisait croire a Electron que l'app etait installee (app.isPackaged) : plus de
    # serveur de dev, plus de hot reload de l'interface (mesure conv-266).
    verifie(exe.name.lower() == "electron.exe", "l'exe de dev garde le nom electron.exe (app.isPackaged)")

    # --- premier passage : tout est construit -----------------------------------------------------
    chemin, etat = dev.preparer(racine, executer=simule)
    verifie(etat == "prepare" and chemin == exe, f"premier passage : exe prepare, pas « {etat} »")
    verifie(exe.read_bytes() == b"EXE-ANNEAU", "l'exe de dev porte le logo")
    verifie(dist.joinpath("electron.exe").read_bytes() == b"EXE-ATOME", "electron.exe d'npm n'est JAMAIS touche")
    for relatif in ("ffmpeg.dll", "locales/fr.pak", "version"):
        copie = exe.parent / relatif
        verifie(copie.is_file() and copie.samefile(dist / relatif),
                f"{relatif} : lien dur vers le fichier d'npm (aucun octet copie)")
    edition = next((a for a in appels if Path(a[0]).name == "rcedit.exe"), [])
    verifie("--set-icon" in edition and str(racine / "build" / "icon.ico") in edition, f"rcedit pose l'icone : {edition}")
    verifie(edition.count("--set-version-string") == 2 and "FileDescription" in edition and "ProductName" in edition,
            f"rcedit nomme le produit (Gestionnaire des taches + nom du raccourci Electron) : {edition}")
    verifie(edition[edition.index("ProductName") + 1] == "Autowin OS Dev",
            "nom de produit « Autowin OS Dev » : celui du raccourci du menu Demarrer")
    verifie(any(Path(a[0]).name.endswith(".neuf.exe") for a in appels if Path(a[0]).name != "rcedit.exe"),
            "la copie reecrite est LANCEE avant de prendre la place de l'exe")
    verifie(not list(exe.parent.glob("*.neuf.exe")), "aucune copie de travail ne reste")

    # --- second passage : rien a refaire ----------------------------------------------------------
    appels.clear()
    chemin, etat = dev.preparer(racine, executer=simule)
    verifie(etat == "pret" and chemin == exe and not appels, f"second passage : pret sans rien lancer, pas « {etat} »")

    # --- logo regenere : seul l'exe est refait, meme s'il est TENU (relais de fond) ----------------
    (racine / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU-V2")
    appels.clear()
    chemin, etat = dev.preparer(racine, executer=simule, tenu=lambda p: p == exe)
    verifie(etat == "prepare" and chemin == exe, f"logo regenere, exe tenu : refait quand meme, pas « {etat} »")
    mis_de_cote = list((exe.parent / ".ancien").glob("*"))
    verifie(len(mis_de_cote) == 1 and mis_de_cote[0].read_bytes() == b"EXE-ANNEAU",
            "exe tenu : l'ancien est RENOMME (ses processus continuent dessus), pas ecrase")
    chemin, etat = dev.preparer(racine, executer=simule)
    verifie(not list((exe.parent / ".ancien").glob("*")), "l'ancien exe mis de cote part au passage suivant")

    # --- npm installe un autre Electron : les liens sont refaits ----------------------------------
    (dist / "ffmpeg.dll").unlink()
    (dist / "ffmpeg.dll").write_bytes(b"DLL-V2")
    (dist / "version").write_text("44.6.0", encoding="utf-8")
    chemin, etat = dev.preparer(racine, executer=simule)
    verifie(etat == "prepare" and (exe.parent / "ffmpeg.dll").read_bytes() == b"DLL-V2",
            f"nouvel Electron : les fichiers suivent, pas « {etat} »")

    # --- echecs : aucun exe de dev, le lanceur retombe sur l'Electron d'npm -----------------------
    (racine / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU-V3")
    avant = exe.read_bytes()
    chemin, etat = dev.preparer(racine, executer=lambda c, **_o: Fin(1))
    verifie(chemin is None and etat.startswith("echec"), f"rcedit en echec : aucun exe de dev, pas « {etat} »")
    verifie(exe.read_bytes() == avant, "rcedit en echec : l'exe de dev en place n'est pas abime")
    verifie(not list(exe.parent.glob("*.neuf.exe")), "apres un echec, la copie de travail est retiree")
    chemin, etat = dev.preparer(racine, executer=simule)
    verifie(etat == "prepare", f"apres un echec, le passage suivant reprend, pas « {etat} »")

    tampon = json.loads((exe.parent / dev.TAMPON).read_text(encoding="utf-8"))
    verifie(tampon.get("electron", {}).get("version") == "44.6.0", f"le tampon decrit l'Electron source : {tampon}")

    (dist / "electron.exe").unlink()
    chemin, etat = dev.preparer(racine, executer=simule)
    verifie(chemin is None and etat.startswith("absent"), f"pas d'Electron d'npm : aucun exe de dev, pas « {etat} »")

# --- reliquats de l'ancienne retouche d'electron.exe (conv-266, avant l'exe de dev) -----------------
with tempfile.TemporaryDirectory() as dossier:
    racine = depot(Path(dossier))
    dist = racine / "node_modules" / "electron" / "dist"
    (dist / "autowin-icone.json").write_text("{}", encoding="utf-8")
    (dist / "electron-atome-1791730503238413200.exe").write_bytes(b"")
    dev.preparer(racine, executer=simule)
    verifie(not (dist / "autowin-icone.json").exists() and not list(dist.glob("electron-atome-*.exe")),
            "les reliquats de l'ancienne retouche de node_modules sont retires")
    noms = {p.name for p in dev.exe_dev(racine).parent.iterdir()}
    verifie("autowin-icone.json" not in noms and not any(n.startswith("electron-atome-") for n in noms),
            "les reliquats ne sont pas recopies dans l'exe de dev")

    # Les exe qu'un garde-fou doit tester avant de toucher node_modules.
    gardes = dev.executables_a_surveiller(racine)
    verifie(dist / "electron.exe" in gardes and dev.exe_dev(racine) in gardes,
            f"les garde-fous surveillent l'Electron d'npm ET l'exe de dev : {gardes}")

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS electron_dev")
