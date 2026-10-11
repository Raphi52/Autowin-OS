"""Tests du logo anneau : le dessin, et les icones du depot qui doivent en etre le rendu.

Lance par `npm run test:logo` (py -3 scripts/logo_anneau_test.py).
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import logo_anneau as logo  # noqa: E402

RACINE = Path(__file__).resolve().parent.parent
ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


def proche(a: tuple[int, ...], b: tuple[int, ...], tolerance: int) -> bool:
    return all(abs(x - y) <= tolerance for x, y in zip(a, b))


# --- le degrade ---------------------------------------------------------------------------------
for angle, teinte in logo.ARRETS:
    verifie(logo.couleur(angle) == teinte, f"a {angle} deg le degrade doit valoir son arret {teinte}")
verifie(proche(logo.couleur(0.0), logo.couleur(359.999), 1),
        "le degrade doit se refermer sans couture a midi")
# Valeurs RELEVEES sur la capture de reference (conv-228) : la ou le degrade a ete mesure.
for angle, mesure in ((60, (114, 115, 249)), (120, (205, 95, 195)), (210, (255, 153, 44)), (345, (37, 152, 173))):
    verifie(proche(logo.couleur(angle), mesure, 8),
            f"a {angle} deg le degrade s'eloigne de la capture : {logo.couleur(angle)} contre {mesure}")

if not logo.PILLOW:
    ECHECS.append("Pillow absent : le logo ne peut pas etre dessine")
else:
    from PIL import Image

    # --- le dessin --------------------------------------------------------------------------------
    image = logo.dessiner_anneau(64)
    verifie(image.size == (64, 64) and image.mode == "RGBA", "un carre RGBA de la taille demandee")
    # « pas de rond noir au milieu, jamais — l'icone c'est un cercle colore, c'est tout »
    # (2026-10-11, conv-228) : le centre est TRANSPARENT, partout.
    verifie(image.getpixel((32, 32))[3] == 0, "le centre de l'anneau est TRANSPARENT, jamais un rond sombre")
    verifie(image.getpixel((0, 0))[3] == 0, "hors du cercle, le fond est TRANSPARENT")
    # Milieu de l'epaisseur, a 3 h (90 deg) : le violet.
    rayon = 64 * logo.REMPLISSAGE / 2
    x = round(32 + rayon * (1 + logo.TROU) / 2)
    verifie(proche(image.getpixel((x, 32))[:3], logo.couleur(90), 12), "a 3 h l'anneau est violet")
    verifie(image.getpixel((x, 32))[3] == 255, "l'epaisseur de l'anneau est opaque")
    verifie(not hasattr(logo, "COEUR"), "aucune couleur de coeur ne doit subsister : le centre est vide")

    # --- les icones du depot SONT ce dessin ---------------------------------------------------------
    # Sinon une icone garde l'ancien atome sans que personne ne le voie avant le menu Demarrer.
    def est_l_anneau(chemin: Path) -> bool:
        im = Image.open(chemin).convert("RGBA")
        cote = im.width
        centre = im.getpixel((cote // 2, cote // 2))
        r = cote * logo.REMPLISSAGE / 2 * (1 + logo.TROU) / 2
        trois_heures = im.getpixel((round(cote / 2 + r), cote // 2))
        return centre[3] == 0 and proche(trois_heures[:3], logo.couleur(90), 16)

    pngs = [RACINE / p for p in ("resources/icon.png", "build/icon.png", "resources/autowin-os-dev.png")]
    for png in pngs:
        verifie(est_l_anneau(png), f"{png.relative_to(RACINE)} doit etre le logo anneau")
    verifie(len({p.read_bytes() for p in pngs}) == 1, "les trois PNG du produit doivent etre IDENTIQUES")
    rail = RACINE / "src/renderer/src/assets/autowin-logo-anneau.png"
    verifie(rail.is_file() and est_l_anneau(rail), "le logo de l'en-tete de la barre laterale doit etre l'anneau")
    verifie(rail.is_file() and Image.open(rail).width == logo.TAILLE_LOGO_RAIL,
            "le logo de l'en-tete est rendu a 4x ses 38 px CSS, pour rester net sur un ecran haute densite")

    for relatif in ("build/icon.ico", "resources/icon.ico", "resources/autowin-os-dev.ico"):
        donnees = (RACINE / relatif).read_bytes()
        _, _, nombre = struct.unpack("<HHH", donnees[:6])
        tailles = sorted(
            (donnees[6 + 16 * i] or 256) for i in range(nombre)
        )
        verifie(tailles == sorted(logo.TAILLES_ICO),
                f"{relatif} doit porter une image NATIVE par taille {logo.TAILLES_ICO}, pas {tailles}")
        ico = Image.open(RACINE / relatif)
        for cote in (16, 32, 256):
            ico.size = (cote, cote)
            ico.load()
            cadre = ico.convert("RGBA")
            verifie(cadre.getpixel((cote // 2, cote // 2))[3] == 0,
                    f"{relatif} {cote} px : le centre doit etre TRANSPARENT (aucun rond noir)")
            ico = Image.open(RACINE / relatif)
    verifie((RACINE / "build/icon.ico").read_bytes() == (RACINE / "resources/autowin-os-dev.ico").read_bytes(),
            "l'icone Dev et l'icone du paquet sont le MEME fichier")
    # L'icone de la zone de notification de l'app installee (src/main/window.ts) : sans elle, la
    # notification retomberait sur le PNG 512 reduit par Windows, flou a 16-24 px.
    icone_notification = RACINE / "resources/icon.ico"
    verifie(icone_notification.is_file()
            and icone_notification.read_bytes() == (RACINE / "build/icon.ico").read_bytes(),
            "resources/icon.ico (icone de notification du paquet) est le MEME fichier que build/icon.ico")
    svg = (RACINE / "build/icon.svg").read_text(encoding="utf-8")
    verifie("logo_anneau.py" in svg and "ellipse" not in svg, "build/icon.svg est l'anneau genere, plus l'atome")
    # « change tous les icones de autowin OS ou ya l'atome par le cercle » (2026-10-11, conv-266) :
    # deux copies a nom unique (`*-c3735beb.ico`, ancien contournement du cache d'icones) portaient
    # encore l'atome, et `resources/**` part dans le paquet. AUCUN .ico du produit n'echappe au logo.
    for ico_produit in sorted([*(RACINE / "build").glob("*.ico"), *(RACINE / "resources").glob("*.ico")]):
        verifie(ico_produit.read_bytes() == (RACINE / "build/icon.ico").read_bytes(),
                f"{ico_produit.relative_to(RACINE)} doit etre le logo anneau (meme fichier que build/icon.ico)")

# --- l'icone INTEGREE a electron.exe (le binaire qui fait tourner l'app en dev) --------------------
# Le Gestionnaire des taches, le melangeur de volume et l'Explorateur lisent l'icone DANS l'exe :
# celui d'npm porte l'atome d'Electron. `poser_sur_electron` la remplace, sur une copie d'abord.
import json  # noqa: E402
import tempfile  # noqa: E402

with tempfile.TemporaryDirectory() as dossier:
    racine_test = Path(dossier)
    dist = racine_test / "node_modules" / "electron" / "dist"
    dist.mkdir(parents=True)
    (racine_test / "build").mkdir()
    (racine_test / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU")
    outil = racine_test / "node_modules" / "electron-winstaller" / "vendor" / "rcedit.exe"
    outil.parent.mkdir(parents=True)
    outil.write_bytes(b"")
    exe = dist / "electron.exe"
    exe.write_bytes(b"EXE-ATOME")
    appels: list[list[str]] = []

    class Fin:
        def __init__(self, code: int) -> None:
            self.returncode = code
            self.stdout = self.stderr = ""

    def rcedit_simule(commande: list[str], **_options: object) -> Fin:
        appels.append([str(c) for c in commande])
        if Path(commande[0]).name == "rcedit.exe":
            cible = Path(commande[1])
            cible.write_bytes(cible.read_bytes().replace(b"ATOME", b"ANNEAU"))
        return Fin(0)

    etat = logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: False)
    verifie(etat == "pose", f"premier passage : l'icone doit etre posee, pas « {etat} »")
    verifie(exe.read_bytes() == b"EXE-ANNEAU", "electron.exe porte l'anneau apres le passage")
    edition = next((a for a in appels if Path(a[0]).name == "rcedit.exe"), [])
    verifie(edition[2:] == ["--set-icon", str(racine_test / "build" / "icon.ico")],
            f"rcedit recoit l'icone du paquet : {edition}")
    verifie(edition[1:2] != [str(exe)], "rcedit travaille sur une COPIE, jamais sur electron.exe en place")
    verifie(not list(dist.glob("*autowin-tmp*")), "la copie de travail ne reste pas dans dist/")
    verifie(any("--version" in " ".join(a) or "-e" in a for a in appels),
            "la copie reecrite est LANCEE une fois avant de remplacer electron.exe")
    tampon = json.loads((dist / logo.TAMPON_ELECTRON).read_text(encoding="utf-8"))
    verifie(tampon.get("exe_taille") == exe.stat().st_size, "le tampon decrit l'exe REECRIT")

    appels.clear()
    etat = logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: False)
    verifie(etat == "deja-pose" and not appels, f"second passage : rien a refaire, pas « {etat} » ({appels})")

    # `npm install` remet l'exe d'origine : l'anneau doit revenir au lancement suivant.
    exe.write_bytes(b"EXE-ATOME-NEUF")
    etat = logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: False)
    verifie(etat == "pose" and exe.read_bytes() == b"EXE-ANNEAU-NEUF",
            f"un exe remplace par npm est reecrit, pas « {etat} »")

    # Logo regenere : l'icone change, l'exe doit suivre.
    (racine_test / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU-V2")
    appels.clear()
    etat = logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: False)
    verifie(etat == "pose" and appels, f"un logo regenere est repose sur l'exe, pas « {etat} »")

    # Exe TENU par des processus (le cas normal, mesure conv-266) : l'ancien est mis de cote par
    # renommage, la copie reecrite prend sa place, et l'ancien part au passage suivant.
    (racine_test / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU-V3")
    exe.write_bytes(b"EXE-ATOME-TENU")
    avant = exe.read_bytes()
    etat = logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: True)
    mis_de_cote = list(dist.glob("electron-atome-*.exe"))
    verifie(etat == "pose", f"exe tenu : l'icone est quand meme posee, pas « {etat} »")
    verifie(len(mis_de_cote) == 1 and mis_de_cote[0].read_bytes() == avant,
            "exe tenu : l'ancien est RENOMME (ses processus continuent dessus), pas ecrase")
    verifie(exe.is_file() and exe.read_bytes() != avant, "exe tenu : electron.exe est la copie reecrite")
    logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: False)
    verifie(not list(dist.glob("electron-atome-*.exe")), "l'ancien exe mis de cote est supprime au passage suivant")

    # rcedit echoue : electron.exe reste INTACT et l'echec est dit.
    (racine_test / "build" / "icon.ico").write_bytes(b"ICO-ANNEAU-V4")
    avant = exe.read_bytes()
    etat = logo.poser_sur_electron(racine_test, executer=lambda c, **_o: Fin(1), verrouille=lambda _p: False)
    verifie(etat.startswith("echec") and exe.read_bytes() == avant,
            f"echec de rcedit : electron.exe intact et echec nomme, pas « {etat} »")
    verifie(not list(dist.glob("*autowin-tmp*")), "apres un echec, la copie de travail est retiree")

    outil.unlink()
    etat = logo.poser_sur_electron(racine_test, executer=rcedit_simule, verrouille=lambda _p: False)
    verifie(etat.startswith("echec") and "rcedit" in etat, f"rcedit absent : echec nomme, pas « {etat} »")

# --- raccourcis : icone a NOM VERSIONNE (conv-266) ---------------------------------------------------
# L'Explorateur range ses images par chemin : sous le meme chemin, il gardait l'atome sur le Bureau.
with tempfile.TemporaryDirectory() as dossier:
    racine_test = Path(dossier) / "depot"
    icones = Path(dossier) / "icones"
    (racine_test / "resources").mkdir(parents=True)
    (racine_test / "build").mkdir()
    source = racine_test / "resources" / "autowin-os-dev.ico"
    source.write_bytes(bytes([1, 2, 3]))
    (racine_test / "build" / "icon.ico").write_bytes(bytes([1, 2, 3]))

    v1 = logo.icone_versionnee(source, icones)
    # MEME empreinte que le test TypeScript (raccourci-demarrer-dev.test.ts) pour les octets 1, 2, 3.
    verifie(v1.name == "autowin-os-dev-039058c6f2c0.ico", f"nom versionne commun aux trois langages : {v1.name}")
    verifie(v1.read_bytes() == source.read_bytes(), "la copie versionnee porte le contenu du logo")
    verifie(logo.icone_versionnee(source, icones) == v1, "meme logo, meme chemin")
    source.write_bytes(bytes([4, 5, 6]))
    v2 = logo.icone_versionnee(source, icones)
    verifie(v2 != v1 and v1.is_file(), "logo modifie : chemin NEUF (l'ancien reste pour qui le vise encore)")

    verifie(logo.source_de_l_icone(f"{racine_test / 'build' / 'icon.ico'},0", racine_test, icones)
            == racine_test / "build" / "icon.ico", "chemin STABLE du depot reconnu")
    verifie(logo.source_de_l_icone(f"{v1},0", racine_test, icones) == source,
            "copie versionnee reconnue : on remonte au logo du depot")
    verifie(logo.source_de_l_icone(r"C:\Program Files\Autre\app.ico,0", racine_test, icones) is None,
            "un raccourci qui vise une AUTRE icone n'est pas le notre")
    # Electron.lnk reecrit par une instance lancee depuis une copie de travail (mesure conv-266).
    copie_agent = r"D:\Autowin\worktrees\e266\agent__run-7f72-1\build\icon.ico,0"
    verifie(logo.source_de_l_icone(copie_agent, racine_test, icones) == racine_test / "build" / "icon.ico",
            "l'icone d'une COPIE DE TRAVAIL (chemin qui disparaitra) est reconnue par son nom")
    verifie(logo.source_de_l_icone(r"C:\Windows\explorer.exe,0", racine_test, icones) is None,
            "une icone tiree d'un exe n'est pas la notre")
    verifie(logo.source_de_l_icone("", racine_test, icones) is None, "raccourci sans icone : ignore")

    lnks = {Path(dossier) / n: v for n, v in (
        ("stable.lnk", f"{racine_test / 'resources' / 'autowin-os-dev.ico'},0"),
        ("perime.lnk", f"{v1},0"),
        ("a-jour.lnk", f"{v2},0"),
        ("etranger.lnk", r"C:\Windows\explorer.exe,0"),
    )}
    for lnk in lnks:
        lnk.write_bytes(b"")
    reecrits: list[Path] = []

    def icone_simulee(lnk: Path, nouvelle: str | None = None) -> str:
        if nouvelle is not None:
            reecrits.append(lnk)
            lnks[lnk] = nouvelle
        return lnks[lnk]

    faits = logo.realigner_raccourcis(racine_test, list(lnks), icones, icone_simulee)
    verifie(sorted(p.name for p in reecrits) == ["perime.lnk", "stable.lnk"],
            f"seuls les raccourcis du logo PAS a jour sont reecrits : {sorted(p.name for p in reecrits)}")
    verifie(all(lnks[Path(dossier) / n] == f"{v2},0" for n in ("stable.lnk", "perime.lnk", "a-jour.lnk")),
            "nos raccourcis visent tous la copie du logo ACTUEL")
    verifie(lnks[Path(dossier) / "etranger.lnk"] == r"C:\Windows\explorer.exe,0", "le raccourci etranger est intact")
    verifie(len(faits) == 2, f"rend les raccourcis reecrits : {faits}")
    reecrits.clear()
    logo.realigner_raccourcis(racine_test, list(lnks), icones, icone_simulee)
    verifie(not reecrits, "second passage : plus rien a reecrire")

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS logo_anneau")
