"""Mesure si les lignes « horizontales » d'une image sont vraiment à plat (conv-1444).

Né du dojo de l'Accueil, refait trois fois : une façade vue de trois-quarts paraissait droite à l'œil, puis
« tordue » une fois posée parmi des plateformes parfaitement horizontales. Ce script remplace le coup d'œil
par une mesure, pour classer des peintures avant de les poser.

Principe : sur les bords francs (gradient fort), l'orientation de chaque petit trait se lit dans le gradient.
On garde les traits presque horizontaux (à moins de 20°) et on rend, pondéré par la force du bord :
  - angle_median : l'inclinaison typique, en degrés, positive quand la ligne DESCEND vers la droite ;
  - part_a_plat : la part des traits à moins de 1,5° de l'horizontale (1 = tout est à plat) ;
  - gauche / droite : l'angle médian du tiers gauche et du tiers droit ; un écart entre eux trahit une
    perspective qui fait converger la façade (vue de trois-quarts) ;
  - verticales_median : l'inclinaison des traits presque verticaux (0 = poteaux d'aplomb).

Usage : python scripts/aplomb_image.py image.png [autre.webp ...] [--masque masque.png] [--boite x0,y0,x1,y1]
Sortie : une ligne JSON par image, puis le classement (part_a_plat décroissante) si plusieurs images.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageFilter


def _gradients(g):
    p = np.pad(g, 1, mode='edge')
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    return gx, gy


def _mediane_ponderee(v, w):
    if v.size == 0 or w.sum() <= 0:
        return None
    o = np.argsort(v)
    c = np.cumsum(w[o])
    return float(v[o][np.searchsorted(c, c[-1] / 2)])


def mesurer(image, masque=None, boite=None, seuil_centile=85.0):
    """Mesure une image PIL (ou un chemin). `masque` : tableau booléen de même taille (True = à mesurer)."""
    im = Image.open(image) if isinstance(image, str) else image
    if masque is None and im.mode in ('RGBA', 'LA'):
        masque = np.asarray(im.getchannel('A')) > 127
    # Un léger flou : un trait tracé en escalier (sans lissage) se lirait comme une suite de paliers à plat.
    g = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(1.5))).astype(float)
    if boite:
        x0, y0, x1, y1 = boite
        g = g[y0:y1, x0:x1]
        masque = None if masque is None else masque[y0:y1, x0:x1]
    gx, gy = _gradients(g)
    mag = np.hypot(gx, gy)
    # Seuil inclusif : sur une image très contrastée, plus de 15 % des pixels peuvent avoir le gradient maximal.
    ok = (mag >= np.percentile(mag, seuil_centile)) & (mag > 1e-6)
    if masque is not None:
        ok &= masque
    # Orientation du trait (perpendiculaire au gradient), ramenée dans [-90, 90[ : 0 = horizontal.
    a = np.degrees(np.arctan2(-gx, gy))
    a = (a + 90) % 180 - 90
    h = ok & (np.abs(a) < 20)
    v = ok & (np.abs(a) > 70)
    ah, wh = a[h], mag[h]
    av = np.where(a[v] > 0, a[v] - 90, a[v] + 90)
    xs = np.nonzero(h)[1]
    W = g.shape[1]
    tiers = lambda m: _mediane_ponderee(ah[m], wh[m])
    r = dict(
        angle_median=_mediane_ponderee(ah, wh),
        part_a_plat=float(wh[np.abs(ah) < 1.5].sum() / wh.sum()) if wh.sum() else None,
        gauche=tiers(xs < W / 3),
        droite=tiers(xs > 2 * W / 3),
        verticales_median=_mediane_ponderee(av, mag[v]),
        traits=int(h.sum()),
    )
    return {k: (round(x, 3) if isinstance(x, float) else x) for k, x in r.items()}


def main(args):
    # La console Windows décode en cp1252 : sans cela « ° » et « à » sortent illisibles.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    masque, boite, images = None, None, []
    i = 0
    while i < len(args):
        if args[i] == '--masque':
            masque = np.asarray(Image.open(args[i + 1]).convert('L')) > 127
            i += 2
        elif args[i] == '--boite':
            boite = tuple(int(x) for x in args[i + 1].split(','))
            i += 2
        else:
            images.append(args[i])
            i += 1
    if not images:
        print(__doc__)
        return 2
    res = []
    for p in images:
        r = dict(image=p, **mesurer(p, masque, boite))
        res.append(r)
        print(json.dumps(r, ensure_ascii=False))
    if len(res) > 1:
        print('classement (le plus à plat d\'abord) :')
        for r in sorted(res, key=lambda r: -(r['part_a_plat'] or 0)):
            print(f"  {r['part_a_plat']:.2f}  angle {r['angle_median']:+.2f}°  gauche {r['gauche']:+.2f}° droite {r['droite']:+.2f}°  {r['image']}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
