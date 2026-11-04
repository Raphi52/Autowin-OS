"""Tests du logo en relief de la barre laterale (conv-1535) : le volume, la lumiere fixe, l'asset.

Lance par `npm run test:logo-relief` (numpy requis, comme scripts/aplomb_image.py).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import logo_anneau as logo  # noqa: E402
import logo_anneau_relief as relief  # noqa: E402

ECHECS: list[str] = []
COTE = logo.TAILLE_LOGO_RAIL


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


def point(angle: float, rayon: float) -> tuple[int, int]:
    """Pixel a `angle` (degres, 0 = midi, horaire) et `rayon` (1 = bord exterieur)."""
    r = rayon * COTE * logo.REMPLISSAGE / 2
    a = math.radians(angle)
    return round(COTE / 2 + r * math.sin(a)), round(COTE / 2 - r * math.cos(a))


def luminance(image: Image.Image, xy: tuple[int, int]) -> float:
    r, v, b, _ = image.getpixel(xy)
    return 0.2126 * r + 0.7152 * v + 0.0722 * b


MILIEU = 1 - (1 - logo.TROU) / 2  # le milieu de l'epaisseur

# --- la forme : fond et trou transparents, l'epaisseur opaque -----------------------------------
droite = relief.dessiner_relief(COTE, tour=0.0, reflet=0.6)
verifie(droite.getpixel((COTE // 2, COTE // 2))[3] == 0, "le trou doit rester transparent (« pas de rond noir »)")
verifie(droite.getpixel((0, 0))[3] == 0, "le fond doit rester transparent")
verifie(droite.getpixel(point(90, MILIEU))[3] == 255, "l'epaisseur de l'anneau doit etre opaque")

# --- l'icone droite : bleu en haut a droite, jaune en bas a gauche, comme build/icon.png --------
r, v, b, _ = droite.getpixel(point(25, MILIEU))
verifie(b > r and b > v, f"a l'arret bleu (25 deg) l'anneau doit etre bleu, pas {(r, v, b)}")
r, v, b, _ = droite.getpixel(point(240, MILIEU))
verifie(r > b and v > b, f"a l'arret jaune (240 deg) l'anneau doit etre jaune, pas {(r, v, b)}")

# --- le relief : la meme teinte brille sous la lumiere (haut gauche) et pas a l'oppose ----------
# Le reflet du studio tombe la ou la normale est la bissectrice de la lumiere et de l'oeil.
# Apres un demi-tour, la teinte qui y etait est passee a l'oppose du centre. Un anneau plat, ou
# une lumiere qui tourne avec lui (l'ancienne rotation CSS), donne deux valeurs egales : refuse.
bissectrice = relief.LUMIERE + np.array([0.0, 0.0, 1.0])
bissectrice /= np.linalg.norm(bissectrice)
angle_reflet = math.degrees(math.atan2(bissectrice[0], bissectrice[1])) % 360
rayon_reflet = MILIEU + math.hypot(bissectrice[0], bissectrice[1]) * (1 - logo.TROU) / 2
demi_tour = relief.dessiner_relief(COTE, tour=0.5, reflet=0.6)
eclaire = luminance(droite, point(angle_reflet, rayon_reflet))
ombre = luminance(demi_tour, point(angle_reflet + 180, rayon_reflet))
verifie(eclaire > ombre * 1.15, f"la lumiere doit rester en haut a gauche : {eclaire:.0f} contre {ombre:.0f}")
verifie(270 < angle_reflet < 360, f"le reflet du studio doit tomber en haut a gauche, pas a {angle_reflet:.0f} deg")

# --- le volume : le dessus du tube est plus clair que son flanc, a teinte egale -----------------
dessus = luminance(droite, point(200, MILIEU))
flanc = luminance(droite, point(200, logo.TROU + 0.03))
verifie(dessus > flanc, f"le dessus du tube doit etre plus clair que son flanc interieur : {dessus:.0f} contre {flanc:.0f}")

# --- l'asset : une boucle sans fin de 3 s, et le rendu de CE module --------------------------
asset = Image.open(relief.ASSET)
verifie(asset.size == (COTE, COTE), f"l'asset doit faire {COTE} px de cote, pas {asset.size}")
verifie(getattr(asset, "n_frames", 1) == relief.IMAGES, f"l'asset doit avoir {relief.IMAGES} images")
verifie(asset.info.get("loop") == 0, "l'asset doit boucler sans fin (loop = 0)")
# Pillow ne rend pas la duree des images d'un WebP : on lit les blocs ANMF du fichier.
octets = relief.ASSET.read_bytes()
durees: list[int] = []
curseur = 12
while curseur + 8 <= len(octets):
    taille = int.from_bytes(octets[curseur + 4 : curseur + 8], "little")
    if octets[curseur : curseur + 4] == b"ANMF":
        durees.append(int.from_bytes(octets[curseur + 20 : curseur + 23], "little"))
    curseur += 8 + taille + (taille & 1)
duree = sum(durees)
verifie(duree == relief.PERIODE_MS, f"une boucle doit durer {relief.PERIODE_MS} ms (un tour en 3 s, conv-929), pas {duree}")
asset.seek(0)
attendu = np.asarray(relief.dessiner_relief(COTE, tour=0.0, reflet=0.1), dtype=np.float64)  # la 1re image de `images()`
lu = np.asarray(asset.convert("RGBA"), dtype=np.float64)
opaque = attendu[..., 3] > 250
ecart = float(np.abs(lu[opaque, :3] - attendu[opaque, :3]).mean())
verifie(ecart < 4, f"l'asset est perime : relancer `py -3 scripts/logo_anneau_relief.py` (ecart moyen {ecart:.1f})")

if ECHECS:
    print("\n".join(f"ECHEC : {e}" for e in ECHECS))
    sys.exit(1)
print("logo en relief : tous les controles passent")
