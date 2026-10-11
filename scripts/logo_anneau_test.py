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

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS logo_anneau")
