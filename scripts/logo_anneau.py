"""LE LOGO d'Autowin OS : un anneau a degrade conique, au centre TRANSPARENT.

D'OU IL VIENT
-------------
Demande du 2026-10-11 (conv-228) : « je veux ca en nouveau logo de Autowin OS au lieu du spinner,
dans le menu demarrer », avec une capture de reference. Il remplace l'atome a trois orbites (qui
servait a la fois de logo et de spinner) dans TOUTES les icones du produit : raccourcis Bureau et
menu Demarrer, fenetre, barre des taches, paquet installe.

LE CENTRE EST VIDE, TOUJOURS. La capture montrait un coeur sombre ; la premiere version l'avait
reproduit en disque opaque. Correction de l'utilisateur, le meme jour : « pas de rond noir au
milieu, jamais — l'icone c'est un cercle colore, c'est tout ». Le trou laisse voir ce qu'il y a
dessous : Bureau, menu Demarrer, carte de la barre laterale, halo du lanceur.

LES VALEURS SONT MESUREES, PAS DEVINEES
--------------------------------------
Relevees pixel par pixel sur la capture (anneau de 107 px de diametre) :
  - rayon exterieur 53,5 px, rayon du trou 24,5 px  -> TROU = 0,458 ;
  - couleur plate dans l'epaisseur (aucun ombrage radial), bords seulement lisses ;
  - degrade conique INTERPOLE EN RVB entre cinq teintes, verifie a +-6 par canal a chaque 15 deg ;
  - fond (18, 13, 25), halo violet gaussien de sigma ~1,3 x le rayon.

UNE SEULE SOURCE
----------------
Ce module dessine le logo pour les icones (`python scripts/logo_anneau.py`) ET pour l'ecran du
lanceur (`launch_dev_splash.py` l'importe et le fait tourner). Deux dessins separes finiraient par
diverger, comme l'atome du lanceur avait diverge de celui de l'app.

Pourquoi des parts de tarte et pas un calcul d'angle par pixel : sans numpy, un `atan2` sur chaque
pixel d'un 4096 x 4096 prendrait des secondes. 360 parts colorees, dessinees en C par Pillow puis
reduites (sur-echantillonnage), donnent le meme degrade lisse en quelques dizaines de millisecondes.
"""

from __future__ import annotations

import struct
import sys
from io import BytesIO
from pathlib import Path

try:  # Le lanceur importe aussi les CONSTANTES : sans Pillow il doit demarrer quand meme.
    from PIL import Image, ImageDraw

    PILLOW = True
except Exception:  # noqa: BLE001 - environnement sans Pillow
    PILLOW = False

# Arrets du degrade : (angle en degres, 0 = midi, sens HORAIRE ; couleur RVB). Mesures sur la capture.
ARRETS: tuple[tuple[float, tuple[int, int, int]], ...] = (
    (25.0, (60, 130, 250)),   # bleu
    (90.0, (166, 104, 251)),  # violet
    (165.0, (255, 84, 101)),  # corail
    (240.0, (250, 197, 17)),  # jaune
    (315.0, (24, 171, 105)),  # vert
)
TROU = 0.458
FOND = (18, 13, 25)
HALO = (76, 61, 113)

# Tailles de l'ICO : Windows choisit le cadre natif au lieu de flouter un 256 (menu Demarrer 24-32,
# Bureau 48, Explorateur 256).
TAILLES_ICO = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
TAILLE_LOGO_RAIL = 152  # 4 x les 38 px CSS de `.brand-logo`
# Marge autour du cercle : un disque plein bord a bord parait plus gros que les icones voisines.
REMPLISSAGE = 0.94

_RACINE = Path(__file__).resolve().parent.parent


def couleur(angle: float) -> tuple[int, int, int]:
    """Couleur du degrade a `angle` (degres, 0 = midi, horaire). Interpolation RVB, cyclique."""
    angle %= 360.0
    for indice, (debut, teinte) in enumerate(ARRETS):
        fin, suivante = ARRETS[(indice + 1) % len(ARRETS)]
        etendue = (fin - debut) % 360.0
        ecart = (angle - debut) % 360.0
        if ecart <= etendue:
            t = ecart / etendue
            return tuple(round(a + (b - a) * t) for a, b in zip(teinte, suivante))  # type: ignore[return-value]
    return ARRETS[0][1]  # inatteignable : les arrets couvrent le tour complet


def dessiner_anneau(
    cote: int,
    diametre: float | None = None,
    rotation: float = 0.0,
    sur: int = 8,
) -> "Image.Image":
    """L'anneau sur fond TRANSPARENT, trou TRANSPARENT, en RGBA de `cote` x `cote`.

    `rotation` (degres, horaire) fait tourner le degrade : c'est l'animation du lanceur.
    `sur` = facteur de sur-echantillonnage ; la reduction finale fait le lissage des bords.
    """
    diametre = cote * REMPLISSAGE if diametre is None else diametre
    grand = cote * sur
    centre = grand / 2
    rayon = diametre * sur / 2
    trou = rayon * TROU

    teintes = Image.new("RGB", (grand, grand), couleur(0))
    trace = ImageDraw.Draw(teintes)
    boite = [centre - rayon - sur, centre - rayon - sur, centre + rayon + sur, centre + rayon + sur]
    for degre in range(360):
        # PIL compte ses angles depuis 3 h ; le degrade, depuis midi. Le recouvrement de 0,6 deg
        # bouche les fentes qu'un arrondi laisserait entre deux parts voisines.
        depart = degre - 90 + rotation
        trace.pieslice(boite, depart - 0.6, depart + 1.6, fill=couleur(degre + 0.5))

    # Le TROU est un vide, pas un disque peint : « pas de rond noir au milieu, jamais ».
    masque = Image.new("L", (grand, grand), 0)
    forme = ImageDraw.Draw(masque)
    forme.ellipse([centre - rayon, centre - rayon, centre + rayon, centre + rayon], fill=255)
    forme.ellipse([centre - trou, centre - trou, centre + trou, centre + trou], fill=0)
    teintes.putalpha(masque)
    # Alpha PREMULTIPLIE pendant la reduction : sinon les pixels transparents (noirs) se melangent a
    # parts egales avec l'anneau, et ses deux bords s'assombrissent d'un liseré.
    return teintes.convert("RGBa").reduce(sur).convert("RGBA")


def _ico(cadres: list["Image.Image"]) -> bytes:
    """ICO multi-tailles aux cadres PNG (format accepte par Windows depuis Vista)."""
    blocs = []
    for image in cadres:
        tampon = BytesIO()
        image.save(tampon, format="PNG", optimize=True)
        blocs.append((image.width, tampon.getvalue()))
    entete = struct.pack("<HHH", 0, 1, len(blocs))
    decalage = 6 + 16 * len(blocs)
    repertoire = b""
    for cote, donnees in blocs:
        dim = 0 if cote >= 256 else cote
        repertoire += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(donnees), decalage)
        decalage += len(donnees)
    return entete + repertoire + b"".join(d for _, d in blocs)


def _svg() -> str:
    """Le meme anneau en vecteur : 180 secteurs de 2 deg (le SVG n'a pas de degrade conique)."""
    import math

    r_ext, r_int, c = 512 * REMPLISSAGE / 2, 512 * REMPLISSAGE / 2 * TROU, 256.0

    def point(rayon: float, angle: float) -> str:
        a = math.radians(angle - 90)
        return f"{c + rayon * math.cos(a):.2f} {c + rayon * math.sin(a):.2f}"

    secteurs = []
    for depart in range(0, 360, 2):
        a, b = depart - 0.4, depart + 2.4
        r, v, bl = couleur(depart + 1)
        secteurs.append(
            f'<path fill="#{r:02x}{v:02x}{bl:02x}" d="M{point(r_ext, a)} '
            f"A{r_ext:.2f} {r_ext:.2f} 0 0 1 {point(r_ext, b)} L{point(r_int, b)} "
            f'A{r_int:.2f} {r_int:.2f} 0 0 0 {point(r_int, a)}Z"/>'
        )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n'
        "<!-- Genere par scripts/logo_anneau.py : ne pas editer a la main. -->\n"
        + "\n".join(secteurs)
        + "\n</svg>\n"
    )


def generer(racine: Path = _RACINE) -> list[Path]:
    """Ecrit toutes les icones du produit. Rend la liste des fichiers ecrits."""
    ecrits: list[Path] = []
    png = dessiner_anneau(512)
    for relatif in ("resources/icon.png", "build/icon.png", "resources/autowin-os-dev.png"):
        chemin = racine / relatif
        png.save(chemin, format="PNG", optimize=True)
        ecrits.append(chemin)
    # Le logo de l'en-tete de la barre laterale (`.brand-logo`, 38 px CSS) : rendu a 4x, reduit
    # proprement par le navigateur, net jusqu'a un ecran a 400 %. Demande du 2026-10-11 (conv-228) :
    # « je garde mon spinner je veux juste changer le logo ici ».
    chemin = racine / "src" / "renderer" / "src" / "assets" / "autowin-logo-anneau.png"
    dessiner_anneau(TAILLE_LOGO_RAIL).save(chemin, format="PNG", optimize=True)
    ecrits.append(chemin)
    # Chaque taille est DESSINEE a sa taille, pas reduite depuis le 512 : a 16 px, une reduction
    # bicubique d'un grand dessin bave ; un rendu natif sur-echantillonne garde un bord net.
    ico = _ico([dessiner_anneau(cote, sur=max(8, 2048 // cote)) for cote in TAILLES_ICO])
    # `resources/icon.ico` : l'icone de la zone de notification de l'app INSTALLEE (src/main/window.ts).
    # `build/` ne part pas dans le paquet, seul `resources/` y est extrait (electron-builder.yml).
    # TOUT autre .ico de ces deux dossiers recoit aussi le logo : le 2026-10-11 (conv-266), deux
    # copies a nom unique (`*-c3735beb.ico`, ancien contournement du cache d'icones) portaient encore
    # l'atome — « change tous les icones de autowin OS ou ya l'atome par le cercle ».
    nommes = [racine / r for r in ("build/icon.ico", "resources/icon.ico", "resources/autowin-os-dev.ico")]
    autres = sorted({*(racine / "build").glob("*.ico"), *(racine / "resources").glob("*.ico")} - set(nommes))
    for chemin in (*nommes, *autres):
        chemin.write_bytes(ico)
        ecrits.append(chemin)
    chemin = racine / "build" / "icon.icns"
    dessiner_anneau(1024, sur=4).save(chemin, format="ICNS")
    ecrits.append(chemin)
    chemin = racine / "build" / "icon.svg"
    chemin.write_bytes(_svg().encode("utf-8"))
    ecrits.append(chemin)
    return ecrits


def _raccourcis_connus() -> list[Path]:
    """Les raccourcis Windows qui affichent le logo : menu Demarrer (dev), Bureau Dev, Bureau paquet."""
    import os

    return [
        Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Electron.lnk",
        # Celui de l'exe de dev (electron_dev.py), nomme d'apres son produit (raccourci-demarrer-dev.ts).
        Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Autowin OS Dev.lnk",
        Path.home() / "Desktop" / "Autowin OS Dev.lnk",
        Path.home() / "Desktop" / "Autowin OS.lnk",
    ]


def dossier_icones_versionnees() -> Path:
    """`%LOCALAPPDATA%\\autowin-os\\icones` : hors du depot, une copie de travail supprimee n'emporte
    pas l'icone d'un raccourci. Meme dossier que src/main/raccourci-demarrer-dev.ts."""
    import os

    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "autowin-os" / "icones"


def icone_versionnee(source: Path, dossier: Path | None = None) -> Path:
    """Copie de `source` dont le NOM porte l'empreinte du contenu ; posee si elle manque.

    POURQUOI (mesure du 2026-10-11, conv-266) : l'anneau avait ete ecrit sous le MEME chemin que
    l'atome, et l'Explorateur dessinait toujours l'atome sur le Bureau ; pointe vers un chemin NEUF,
    le meme raccourci a montre l'anneau aussitot. Un logo modifie = un nom neuf = une image relue.
    MEME REGLE que `cheminIconeVersionnee` (TypeScript) et create-dev-shortcut.ps1 :
    `<nom>-<12 premiers hexa du SHA-256>.ico`.
    """
    import hashlib

    contenu = source.read_bytes()
    dossier = dossier or dossier_icones_versionnees()
    cible = dossier / f"{source.stem}-{hashlib.sha256(contenu).hexdigest()[:12]}{source.suffix}"
    if not cible.is_file():
        dossier.mkdir(parents=True, exist_ok=True)
        cible.write_bytes(contenu)
    return cible


def source_de_l_icone(icone_actuelle: str, racine: Path, dossier: Path) -> Path | None:
    """L'icone du DEPOT qu'affiche un raccourci (`chemin,index`), ou None s'il vise autre chose.

    Reconnait l'icone par son NOM (`icon.ico`, `autowin-os-dev.ico`, ou leur copie versionnee), ou
    qu'elle soit : le 2026-10-11 (conv-266), `Electron.lnk` visait `build/icon.ico` d'une COPIE DE
    TRAVAIL d'agent (une instance lancee depuis elle l'avait reecrit), et ce chemin disparait avec
    elle — Windows retombe alors sur l'icone d'electron.exe, l'atome. Une icone d'un autre nom n'est
    pas la notre : le raccourci reste intact.
    """
    import os
    import re

    if not icone_actuelle:
        return None
    chemin = Path(icone_actuelle.rsplit(",", 1)[0])
    if chemin.suffix.lower() != ".ico":
        return None
    parent = os.path.normcase(str(chemin.parent))
    for depot in (racine / "build", racine / "resources"):
        if parent == os.path.normcase(str(depot)):
            return chemin if chemin.is_file() else None
    nom = re.sub(r"-[0-9a-f]{12}$", "", chemin.stem)
    for depot in (racine / "resources", racine / "build"):
        if (depot / f"{nom}.ico").is_file():
            return depot / f"{nom}.ico"
    return None


def _icone_du_raccourci_windows(raccourci: Path, nouvelle: str | None = None) -> str:
    """Lit (et, si `nouvelle`, reecrit) l'icone d'un .lnk par WScript.Shell. Rend l'icone RELUE.

    Verifie le 2026-10-11 (conv-266) sur une copie de `Electron.lnk` : la reecriture garde l'identite
    de l'app (System.AppUserModel.ID) et le CLSID des notifications.
    """
    import os
    import subprocess

    script = (
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $w = New-Object -ComObject WScript.Shell; "
        "$l = $w.CreateShortcut($env:AUTOWIN_LNK); "
        "if ($env:AUTOWIN_ICONE) { $l.IconLocation = $env:AUTOWIN_ICONE; $l.Save(); "
        "$l = $w.CreateShortcut($env:AUTOWIN_LNK) }; [Console]::Out.Write($l.IconLocation)"
    )
    fin = subprocess.run(  # noqa: S603 - arguments fixes, chemins passes par l'environnement
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        env={**os.environ, "AUTOWIN_LNK": str(raccourci), "AUTOWIN_ICONE": nouvelle or ""},
        capture_output=True,
        timeout=60,
        creationflags=0x08000000 if sys.platform == "win32" else 0,  # CREATE_NO_WINDOW
    )
    if fin.returncode != 0:
        raise OSError(f"raccourci {raccourci} : powershell code {fin.returncode} {fin.stderr.decode('utf-8', 'replace')[:200]}")
    return fin.stdout.decode("utf-8", "replace").strip()


def realigner_raccourcis(
    racine: Path = _RACINE,
    raccourcis: list[Path] | None = None,
    dossier: Path | None = None,
    icone_du_raccourci=None,
) -> list[tuple[Path, str]]:
    """Pointe chaque raccourci connu vers la copie VERSIONNEE du logo qu'il affiche.

    A rejouer apres chaque `generer` : le contenu change, donc le nom versionne aussi, et l'Explorateur
    comme le menu Demarrer relisent l'image. Rend les (raccourci, nouvelle icone) reecrits.
    Le demarrage de l'app (menu Demarrer) et create-dev-shortcut.ps1 (Bureau) visent le meme chemin.
    """
    if sys.platform != "win32" and icone_du_raccourci is None:
        return []
    icone_du_raccourci = icone_du_raccourci or _icone_du_raccourci_windows
    dossier = dossier or dossier_icones_versionnees()
    ecrits: list[tuple[Path, str]] = []
    for raccourci in raccourcis if raccourcis is not None else _raccourcis_connus():
        if not raccourci.is_file():
            continue
        actuelle = icone_du_raccourci(raccourci)
        source = source_de_l_icone(actuelle, racine, dossier)
        if source is None:
            continue
        voulue = f"{icone_versionnee(source, dossier)},0"
        if actuelle.lower() == voulue.lower():
            continue
        relue = icone_du_raccourci(raccourci, voulue)
        if relue.lower() != voulue.lower():
            raise OSError(f"raccourci {raccourci} : icone relue « {relue} », attendue « {voulue} »")
        ecrits.append((raccourci, voulue))
    return ecrits


def prevenir_windows(fichiers: list[Path]) -> list[Path]:
    """Dit au shell Windows que ces icones ont change. Rend les chemins notifies.

    CE QUE CA NE FAIT PAS. Conv-228 avait conclu que `SHCNE_UPDATEITEM` + `SHCNE_ASSOCCHANGED`
    faisaient passer le Bureau et le menu Demarrer a l'anneau, sur la foi d'une relecture par l'API
    du shell DEPUIS UN AUTRE PROCESSUS. Faux : le 2026-10-11 (conv-266), le Bureau capture tel que
    l'Explorateur le DESSINE (PrintWindow sur sa liste d'icones) montrait toujours l'atome, et
    `SHUpdateImage` n'y a rien change non plus. L'Explorateur range ses images PAR CHEMIN : seul un
    chemin neuf les fait relire — d'ou `icone_versionnee` et `realigner_raccourcis` ci-dessous.
    """
    if sys.platform != "win32":
        return []
    import ctypes

    shell32 = ctypes.windll.shell32  # type: ignore[attr-defined]
    shell32.SHChangeNotify.argtypes = [ctypes.c_long, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    notifies = [p for p in (*fichiers, *_raccourcis_connus()) if p.is_file()]
    for chemin in notifies:
        # SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH
        shell32.SHChangeNotify(0x00002000, 0x0005 | 0x1000, ctypes.c_wchar_p(str(chemin)), None)
    shell32.SHChangeNotify(0x08000000, 0x1000, None, None)  # SHCNE_ASSOCCHANGED, SHCNF_FLUSH
    return notifies


if __name__ == "__main__":
    cible = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else _RACINE
    ecrits = generer(cible)
    for fichier in ecrits:
        print(f"ecrit : {fichier}")
    # L'exe de dev (electron_dev.py) reprend le nouveau logo au prochain lancement par le lanceur.
    for raccourci, icone in realigner_raccourcis(cible):
        print(f"raccourci realigne : {raccourci} -> {icone}")
    for chemin in prevenir_windows([f for f in ecrits if f.suffix in (".ico", ".png")]):
        print(f"cache d'icones Windows prevenu : {chemin}")
