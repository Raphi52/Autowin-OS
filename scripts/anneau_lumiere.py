"""La lumiere d'un anneau, image par image — pour copier un effet lumineux, puis prouver la copie.

Pourquoi : reproduire « a la perfection » l'anneau d'un bouton (une video Pinterest) sur le bord des
blocs du fil demandait de lire chaque image a l'oeil, puis de juger la copie a l'oeil. Ce script
deroule l'anneau en secteurs, dans le sens horaire depuis midi, et rend pour CHAQUE image une ligne
de texte (ce que montre l'image : part de blanc, de chaud, de froid, de noir, ou sont les eclats),
puis un bilan comparable d'une source a l'autre : l'ordre des couleurs autour du blanc, la longueur
des franges et des blancs (en part du tour), la palette mediane de chaque famille.

L'anneau est un CERCLE (`--cercle cx,cy,r`, le rayon au milieu du trait) ou un RECTANGLE ARRONDI
(`--rect x,y,l,h,rayon`, le bord exterieur du bloc) ; `--epaisseur` est la largeur du trait. Dans
chaque secteur, le pixel le plus lumineux a travers le trait fait foi.

Usage :
  python scripts/anneau_lumiere.py <images...> (--cercle cx,cy,r | --rect x,y,l,h,rayon)
         [--epaisseur 14] [--fps 30] [--secteurs 360] [--json bilan.json] [--silence]
  <images...> : des fichiers PNG/JPG, ou un dossier (ses images, dans l'ordre du nom).
Code 0 ; 2 si aucune image ou une forme invalide.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FAMILLES = ('blanc', 'chaud', 'froid', 'pale', 'sombre', 'autre')


def contour_cercle(cx: float, cy: float, r: float, n: int):
    """Points et normales du cercle, sens horaire a l'ecran (y vers le bas), depuis midi."""
    a = -math.pi / 2 + 2 * math.pi * np.arange(n) / n
    return np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], 1), np.stack([np.cos(a), np.sin(a)], 1)


def contour_rect(x: float, y: float, l: float, h: float, rayon: float, n: int):
    """Points et normales de la ligne mediane d'un rectangle arrondi, sens horaire depuis le milieu
    du bord haut, a pas egaux le long du tour."""
    rayon = max(0.0, min(rayon, l / 2, h / 2))
    droits = [l - 2 * rayon, h - 2 * rayon, l - 2 * rayon, h - 2 * rayon]
    arc = math.pi / 2 * rayon
    tour = sum(droits) + 4 * arc
    # Segments dans l'ordre horaire, depuis le coin haut-gauche apres l'arc : haut, coin HD, droite,
    # coin BD, bas, coin BG, gauche, coin HG.
    coins = [(x + l - rayon, y + rayon), (x + l - rayon, y + h - rayon), (x + rayon, y + h - rayon), (x + rayon, y + rayon)]
    depart_arcs = [-math.pi / 2, 0.0, math.pi / 2, math.pi]
    debuts_droits = [(x + rayon, y), (x + l, y + rayon), (x + l - rayon, y + h), (x, y + h - rayon)]
    directions = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    normales_droits = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    pts, nrm = [], []
    s0 = (l - 2 * rayon) / 2  # le milieu du bord haut
    for k in range(n):
        s = (s0 + tour * k / n) % tour
        for i in range(4):
            if s < droits[i]:
                (px, py), (dx, dy) = debuts_droits[i], directions[i]
                pts.append((px + dx * s, py + dy * s)); nrm.append(normales_droits[i]); break
            s -= droits[i]
            if s < arc:
                t = depart_arcs[i] + s / max(rayon, 1e-9)
                cx, cy = coins[i]
                pts.append((cx + rayon * math.cos(t), cy + rayon * math.sin(t))); nrm.append((math.cos(t), math.sin(t))); break
            s -= arc
    return np.array(pts, float), np.array(nrm, float)


def echantillon(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Valeur bilineaire aux coordonnees (x, y), bornee a l'image."""
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001); y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def teinte(rgb: np.ndarray):
    """Teinte (degres), saturation et valeur (HSV) de pixels RGB 0-1."""
    mx = rgb.max(-1); mi = rgb.min(-1); d = np.maximum(mx - mi, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, np.where(mx > 0, (mx - mi) / np.maximum(mx, 1e-6), 0), mx


def familles(rgb: np.ndarray) -> np.ndarray:
    """La famille de chaque pixel : blanc, chaud (rouge a jaune), froid (cyan a indigo), pale, sombre."""
    h, s, v = teinte(rgb)
    sortie = np.full(h.shape, 'autre', dtype=object)
    sortie[(h < 70) | (h > 320)] = 'chaud'
    sortie[(h >= 160) & (h <= 260)] = 'froid'
    sortie[s < 0.45] = 'pale'
    sortie[(s < 0.25) & (v > 0.85)] = 'blanc'
    sortie[v < 0.3] = 'sombre'
    return sortie


def segments(masque: np.ndarray):
    """(debut, longueur) des suites circulaires de True."""
    n = len(masque)
    if masque.all():
        return [(0, n)]
    sortie = []
    for d in range(n):
        if masque[d] and not masque[d - 1]:
            L = 0
            while masque[(d + L) % n]:
                L += 1
            sortie.append((d, L))
    return sortie


def heure(secteur: int, n: int) -> str:
    """Position sur un cadran : 12h en haut, sens horaire."""
    return f"{round(secteur / n * 12) % 12 or 12}h"


def hexa(rgb) -> str:
    return '#' + ''.join(f'{int(round(min(1, max(0, c)) * 255)):02x}' for c in rgb)


def mesurer(images: list[Path], forme: tuple, epaisseur: float, secteurs: int, fps: float, silence: bool = False) -> dict:
    """Deroule l'anneau de chaque image et rend le bilan ; ecrit une ligne par image sauf `silence`."""
    nature, valeurs = forme
    pts, nrm = (contour_cercle if nature == 'cercle' else contour_rect)(*valeurs, secteurs)
    if nature == 'rect':  # la ligne mediane du trait, pas le bord exterieur
        x, y, l, h, r = valeurs
        pts, nrm = contour_rect(x + epaisseur / 2, y + epaisseur / 2, l - epaisseur, h - epaisseur, max(0, r - epaisseur / 2), secteurs)
    travers = np.linspace(-epaisseur / 2, epaisseur / 2, max(3, int(epaisseur * 2) + 1))
    X = pts[:, 0][:, None] + nrm[:, 0][:, None] * travers[None, :]
    Y = pts[:, 1][:, None] + nrm[:, 1][:, None] * travers[None, :]
    toutes, couleurs = [], []
    for i, chemin in enumerate(images):
        img = np.asarray(Image.open(chemin).convert('RGB')).astype(np.float32) / 255
        p = echantillon(img, X, Y)                       # (secteurs, travers, 3)
        rgb = p[np.arange(secteurs), p.max(-1).argmax(1)]  # le plus lumineux a travers le trait
        f = familles(rgb)
        toutes.append(f); couleurs.append(rgb)
        if not silence:
            parts = ' '.join(f"{k} {100 * (f == k).mean():3.0f}%" for k in FAMILLES[:5])
            eclats = sorted(segments(f == 'blanc'), key=lambda s: -s[1])[:3]
            texte = ', '.join(f"{heure(d + L // 2, secteurs)} ({L * 360 / secteurs:.0f}°)" for d, L in eclats) or 'aucun'
            print(f"t={i / fps:5.2f}s  {parts}  eclats : {texte}")
    F = np.array(toutes); C = np.array(couleurs)
    bilan = {'images': len(images), 'secteurs': secteurs}
    bilan['parts'] = {k: round(float((F == k).mean()), 3) for k in FAMILLES}
    # L'ordre autour du blanc : premiere famille franche rencontree en sortant d'un blanc, par sens.
    ordre = {'horaire': {'chaud': 0, 'froid': 0}, 'antihoraire': {'chaud': 0, 'froid': 0}}
    longueurs, franges = [], {'chaud': [], 'froid': []}
    for f in F:
        for d, L in segments(f == 'blanc'):
            if L == secteurs:
                continue
            longueurs.append(L)
            for sens, depart, pas in (('horaire', d + L - 1, 1), ('antihoraire', d, -1)):
                for k in range(1, secteurs // 8):
                    fam = f[(depart + pas * k) % secteurs]
                    if fam in ('chaud', 'froid'):
                        ordre[sens][fam] += 1
                        # longueur de la frange : jusqu'au noir ou a un autre blanc
                        j = k
                        while j < secteurs // 4 and f[(depart + pas * j) % secteurs] not in ('sombre', 'blanc'):
                            j += 1
                        franges[fam].append(j)
                        break
                    if fam in ('sombre', 'blanc'):
                        break
    bilan['ordre_autour_du_blanc'] = ordre
    a_tour = lambda v: round(float(v) / secteurs, 3)
    bilan['blanc_median_part_du_tour'] = a_tour(np.median(longueurs)) if longueurs else None
    bilan['frange_mediane_part_du_tour'] = {k: a_tour(np.median(v)) if v else None for k, v in franges.items()}
    h, s, v = teinte(C)
    palette = {}
    for fam in ('chaud', 'froid'):
        m = F == fam
        palette[fam] = {}
        for nom, lo, hi in (('vive', 0.9, 1.01), ('moyenne', 0.7, 0.9), ('sombre', 0.45, 0.7)):
            mm = m & (v >= lo) & (v < hi)
            palette[fam][nom] = hexa(np.median(C[mm], 0)) if mm.sum() >= 20 else None
    bilan['palette'] = palette
    eclairage = [(f == 'blanc').mean() for f in F]
    bilan['blanc_par_image'] = {'min': round(float(min(eclairage)), 3), 'max': round(float(max(eclairage)), 3)}
    return bilan


def lire_forme(args) -> tuple:
    if args.cercle:
        v = [float(x) for x in args.cercle.split(',')]
        if len(v) != 3:
            raise ValueError('--cercle attend cx,cy,r')
        return ('cercle', tuple(v))
    v = [float(x) for x in args.rect.split(',')]
    if len(v) != 5:
        raise ValueError('--rect attend x,y,l,h,rayon')
    return ('rect', tuple(v))


def principal(argv: list[str]) -> int:
    parseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parseur.add_argument('images', nargs='+')
    groupe = parseur.add_mutually_exclusive_group(required=True)
    groupe.add_argument('--cercle'); groupe.add_argument('--rect')
    parseur.add_argument('--epaisseur', type=float, default=14)
    parseur.add_argument('--fps', type=float, default=30)
    parseur.add_argument('--secteurs', type=int, default=360)
    parseur.add_argument('--json')
    parseur.add_argument('--silence', action='store_true')
    args = parseur.parse_args(argv)
    sys.stdout.reconfigure(encoding='utf-8')
    images: list[Path] = []
    for entree in args.images:
        chemin = Path(entree)
        if chemin.is_dir():
            images += sorted(p for p in chemin.iterdir() if p.suffix.lower() in ('.png', '.jpg', '.jpeg'))
        elif chemin.exists():
            images.append(chemin)
    if not images:
        print('aucune image', file=sys.stderr)
        return 2
    try:
        forme = lire_forme(args)
    except ValueError as erreur:
        print(erreur, file=sys.stderr)
        return 2
    bilan = mesurer(images, forme, args.epaisseur, args.secteurs, args.fps, args.silence)
    texte = json.dumps(bilan, ensure_ascii=False, indent=2)
    if args.json:
        Path(args.json).write_text(texte, encoding='utf-8')
    print(texte)
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv[1:]))
