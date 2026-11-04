"""LE LOGO DE LA BARRE LATERALE EN RELIEF : l'anneau d'Autowin en volume, qui tourne sous une lumiere fixe.

D'OU IL VIENT
-------------
Demande du 2026-11-04 (conv-1535). Le film de l'ecran « nouveau fil » montre l'icone d'Autowin en
volume ; l'utilisateur : « j'aime bien l'effet 3D que t'as mis sur l'anneau », « je voulais vraiment
juste refaire l'anneau de autowin pour ici » (capture de l'en-tete de la barre laterale), « dans la
video tu lui as donne du relief, j'ai bien aime ».

LE MEME RENDU QUE LE FILM, CALCULE ICI
-------------------------------------
Le film dessine un tore avec un shader three.js (autowin-video/film/teaser-fil/icone-autowin.js),
puis la passe finale du film (kit/post.js) : ACES, ombres froides et hautes lumieres chaudes, sRGB.
Ce module refait ces deux calculs pixel par pixel avec numpy, pour un tore vu de face : la normale
d'un tore de face se calcule exactement, sans moteur 3D ni navigateur.
  - corps plus sombre sur les flancs : c x (0,5 + 0,5 m^1,4), m = normale vers l'oeil ;
  - liseré dans sa propre couleur sur les bords : c x 0,8 (1 - m)^3 ;
  - lumiere fixe du studio, en haut a gauche (speculaire en puissance 36) ;
  - reflet etroit qui fait le tour, sans blanchir l'anneau.
Le grain et le bloom du film n'y sont pas : un grain tire a chaque image scintillerait sur 38 px.

CE QUI TOURNE
-------------
Le logo tourne d'un tour en 3 s (conv-929 : « fais en sorte que le logo rond tourne », 8 s « trop
lent »). Avant, `app-shell.css` faisait tourner l'image entiere ; avec du relief, la lumiere
tournerait avec elle et l'anneau redeviendrait un autocollant plat. Ici, c'est le DEGRADE qui fait
son tour dans l'image, la lumiere reste en haut a gauche : le CSS ne fait plus tourner `.brand-logo`.
L'image animee tourne aussi quand Windows reduit les animations, comme l'exigeait conv-929.

Les couleurs, le trou et la marge viennent de `logo_anneau.py` : une seule source pour l'anneau.

Usage : `py -3 scripts/logo_anneau_relief.py` reecrit l'asset de la barre laterale.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import logo_anneau as logo  # noqa: E402

RACINE = Path(__file__).resolve().parent.parent
ASSET = RACINE / "src" / "renderer" / "src" / "assets" / "autowin-logo-anneau-relief.webp"

PERIODE_MS = 3000  # un tour de l'anneau (conv-929)
IMAGES = 120  # 40 images/s : le degrade avance de 3 deg par image, a 38 px aucun cran ne se voit
REFLET_TOURS = 2  # le reflet fait deux tours pendant que l'anneau en fait un : il le double, comme dans le film
INTENSITE = 1.25  # l'eclat de l'anneau dans la boucle du film (scene.js, `intensite`)
LUMIERE = np.array([-0.45, 0.7, 0.55]) / np.linalg.norm([-0.45, 0.7, 0.55])  # icone-autowin.js

# Le degrade en lumiere lineaire, echantillonne finement : le film lit une texture de 48 teintes,
# plus fin ici pour qu'aucune bande ne se voie quand il tourne.
_TEINTES = 720
_DEGRADE = (np.array([logo.couleur(i * 360.0 / _TEINTES) for i in range(_TEINTES)], dtype=np.float64) / 255.0) ** 2.2


def _aces(x: np.ndarray) -> np.ndarray:
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)


def _smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _passe_finale(lineaire: np.ndarray) -> np.ndarray:
    """kit/post.js, `mFinal` : ACES, etalonnage (ombres froides, hautes lumieres chaudes), sRGB."""
    c = _aces(lineaire)
    lum = (c @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    c = c + (c * np.array([0.9, 0.98, 1.12]) - c) * ((1.0 - _smoothstep(0.0, 0.3, lum)) * 0.7)
    c = c + (c * np.array([1.05, 1.0, 0.93]) - c) * (_smoothstep(0.35, 1.0, lum) * 0.55)
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0.0031308), 1 / 2.4) - 0.055)


def dessiner_relief(cote: int, tour: float = 0.0, reflet: float = 0.1, sur: int = 4) -> Image.Image:
    """L'anneau en volume, RGBA `cote` x `cote`, fond et trou TRANSPARENTS.

    `tour` : fraction de tour du degrade (0 = l'icone droite, bleu en haut a droite) ;
    `reflet` : position du reflet sur le tour ; `sur` : sur-echantillonnage des bords.
    """
    n = cote * sur
    rayon = cote * logo.REMPLISSAGE / 2 * sur
    axe = (np.arange(n) + 0.5 - n / 2) / rayon
    x, y = np.meshgrid(axe, -axe)  # y vers le HAUT, comme dans le shader
    r = np.hypot(x, y)
    tube = (1.0 - logo.TROU) / 2
    ecart = r - (1.0 - tube)
    dedans = np.abs(ecart) < tube

    # Normale d'un tore vu de face : radiale dans le plan, et sa composante vers l'oeil.
    rs = np.where(r > 0, r, 1.0)
    e = np.where(dedans, ecart / tube, 0.0)
    m = np.sqrt(np.clip(1.0 - e * e, 0.0, 1.0))
    normale = np.stack([x / rs * e, y / rs * e, m], axis=-1)

    a = np.mod(np.arctan2(x, y) / (2 * np.pi) + 1.0, 1.0)  # 0 en haut, sens horaire, comme l'icone
    c = _DEGRADE[(np.mod(a - tour, 1.0) * _TEINTES).astype(int) % _TEINTES]
    m3 = m[..., None]
    col = c * (0.5 + 0.5 * m3**1.4) * INTENSITE  # le corps, plus sombre sur les flancs
    col += c * (1.0 - m3) ** 3 * INTENSITE * 0.8  # le liseré, dans sa propre couleur
    # reflect(-l, n) . v, avec v = l'oeil : -l.z + 2 (l . n) n.z
    sp = np.maximum(-LUMIERE[2] + 2 * (normale @ LUMIERE) * m, 0.0) ** 36
    col += (c + (1.0 - c) * 0.5) * sp[..., None] * INTENSITE * 0.25  # la lumiere fixe du studio
    d = np.abs(np.mod(a - reflet + 0.5, 1.0) - 0.5)
    col += (c + (1.0 - c) * 0.3) * (np.exp(-d * d * 900.0) * m * m)[..., None] * INTENSITE * 0.5  # le reflet

    rvb = _passe_finale(col)
    couverture = dedans.astype(np.float64)
    # Alpha PREMULTIPLIE pendant la reduction (meme raison que logo_anneau.py : pas de liseré noir).
    pre = np.concatenate([rvb * couverture[..., None], couverture[..., None]], axis=-1)
    pre = pre.reshape(cote, sur, cote, sur, 4).mean(axis=(1, 3))
    alpha = pre[..., 3:4]
    rvb_final = np.where(alpha > 0, pre[..., :3] / np.maximum(alpha, 1e-9), 0.0)
    octets = np.round(np.concatenate([rvb_final, alpha], axis=-1) * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(octets, "RGBA")


def images(cote: int = logo.TAILLE_LOGO_RAIL) -> list[Image.Image]:
    """Une boucle complete : le degrade fait un tour, le reflet deux ; la derniere rejoint la premiere."""
    return [
        dessiner_relief(cote, tour=i / IMAGES, reflet=0.1 + REFLET_TOURS * i / IMAGES)
        for i in range(IMAGES)
    ]


def generer(chemin: Path = ASSET) -> Path:
    cadres = images()
    duree = PERIODE_MS // IMAGES
    cadres[0].save(
        chemin,
        format="WEBP",
        save_all=True,
        append_images=cadres[1:],
        duration=duree,
        loop=0,  # sans fin
        lossless=False,
        quality=92,
        alpha_quality=100,
        method=6,
    )
    return chemin


if __name__ == "__main__":
    ecrit = generer()
    print(f"{ecrit} ({ecrit.stat().st_size} octets, {IMAGES} images de {PERIODE_MS // IMAGES} ms)")
