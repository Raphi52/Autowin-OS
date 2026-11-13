"""La lumiere de l'anneau du pin, relevee image par image, pour la REJOUER sur le bord des blocs du fil.

Pourquoi : le reflet des blocs encadres du chat (src/renderer/src/components/reflet-du-pin.ts) copie
l'anneau d'un bouton de verre, l'epingle Pinterest https://fr.pinterest.com/pin/941744972113082896/
(video de 5 s, 30 images/s, bouclee). Deux essais d'interpretation (une vague diagonale, puis une
palette et des franges choisies a la main) s'en ecartaient : on ne decrit plus la lumiere, on la
releve. Ce script deroule l'anneau de chaque image et ecrit une TEXTURE que l'application rejoue
telle quelle le long du bord de chaque bloc.

Texture (WebP sans perte, 360 x 150*5) : une colonne par degre (0 = midi, sens horaire), cinq lignes par image :
  0  lueur interieure  — la lumiere ajoutee a 1 px de bloc DANS l'anneau (au-dessus du verre au repos)
  1  anneau, tiers interieur   } couleurs absolues de l'anneau, en trois tiers
  2  anneau, tiers du milieu   } de son epaisseur (l'anneau du bloc fait 3 px :
  3  anneau, tiers exterieur   } un tiers = un pixel)
  4  lueur exterieure  — la lumiere ajoutee a 1 px de bloc HORS de l'anneau
L'echelle : l'anneau du pin fait 17 px d'epaisseur (de r = 109,5 a 126,5 autour du centre ajuste),
celui des blocs 3 px. Le script imprime aussi la DECROISSANCE de la lueur, en px de bloc depuis le
bord de l'anneau, a reporter dans reflet-du-pin.ts (`DECROISSANCE_*`).

Usage :
  ffmpeg -i <video du pin> -vf fps=30 <dossier>/f%03d.png      (150 images 720 x 720)
  python scripts/anneau-du-pin.py <dossier> [--sortie src/renderer/src/assets/anneau-du-pin.webp]
Code 0 ; 2 si le dossier ne contient pas d'images.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# L'anneau au repos (profil radial median des secteurs eteints) : liseres clairs a r = 110 et
# r = 126, corps noir entre les deux. Allume, il tient de 109,5 a 124 a mi-hauteur.
BORD_INTERIEUR, BORD_EXTERIEUR = 109.5, 126.5
PX_DU_BLOC = (BORD_EXTERIEUR - BORD_INTERIEUR) / 3  # un pixel de bloc, en pixels du pin
DEGRES = 360


def centre_de_l_anneau(images: list[np.ndarray]) -> tuple[float, float]:
    """Centre du cercle ajuste sur le lieu des pixels les plus lumineux de l'anneau."""
    cx0, cy0 = 360.0, 360.0
    ang = np.deg2rad(np.arange(0, 360, 2))
    rs = np.arange(80, 160, 0.5)
    X = cx0 + rs[None, :] * np.cos(ang)[:, None]
    Y = cy0 + rs[None, :] * np.sin(ang)[:, None]
    xs, ys = [], []
    for im in images[::3]:
        v = im.max(axis=2)[np.round(Y).astype(int), np.round(X).astype(int)]
        k, vm = v.argmax(axis=1), v.max(axis=1)
        garde = vm > 0.55
        xs += list((cx0 + rs[k] * np.cos(ang))[garde])
        ys += list((cy0 + rs[k] * np.sin(ang))[garde])
    x, y = np.array(xs), np.array(ys)
    # Cercle algebrique : x² + y² + D x + E y + F = 0.
    D, E, _ = np.linalg.lstsq(np.c_[x, y, np.ones_like(x)], -(x * x + y * y), rcond=None)[0]
    return -D / 2, -E / 2


def deroule(images: list[np.ndarray], cx: float, cy: float, rs: np.ndarray) -> np.ndarray:
    """(images, 360 degres, rayons, RGB), interpolation bilineaire ; 0 degre = midi, sens horaire."""
    th = np.deg2rad(np.arange(DEGRES) + 0.5)
    X = cx + rs[None, :] * np.sin(th)[:, None]
    Y = cy - rs[None, :] * np.cos(th)[:, None]
    x0, y0 = np.floor(X).astype(int), np.floor(Y).astype(int)
    fx, fy = (X - x0)[..., None], (Y - y0)[..., None]
    sortie = np.empty((len(images), DEGRES, len(rs), 3), np.float32)
    for i, im in enumerate(images):
        sortie[i] = (
            im[y0, x0] * (1 - fx) * (1 - fy)
            + im[y0, x0 + 1] * fx * (1 - fy)
            + im[y0 + 1, x0] * (1 - fx) * fy
            + im[y0 + 1, x0 + 1] * fx * fy
        )
    return sortie


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('dossier')
    p.add_argument('--sortie', default='src/renderer/src/assets/anneau-du-pin.webp')
    a = p.parse_args(argv)
    fichiers = sorted(Path(a.dossier).glob('*.png'))
    if not fichiers:
        print(f'aucune image dans {a.dossier}', file=sys.stderr)
        return 2
    images = [np.asarray(Image.open(f).convert('RGB')).astype(np.float32) / 255 for f in fichiers]
    cx, cy = centre_de_l_anneau(images)
    pas = 0.5
    rs = np.arange(BORD_INTERIEUR - 6 * PX_DU_BLOC, BORD_EXTERIEUR + 9 * PX_DU_BLOC + pas, pas)
    P = deroule(images, cx, cy, rs)

    def bande(r_min: float, r_max: float, source: np.ndarray = P) -> np.ndarray:
        m = (rs >= r_min) & (rs < r_max)
        return source[:, :, m].mean(axis=2)

    # La lumiere AJOUTEE : l'exces sur le repos de chaque point (son 5e centile dans le temps).
    repos = np.percentile(P, 5, axis=0, keepdims=True)
    exces = np.clip(P - repos, 0, None)
    t = PX_DU_BLOC
    lignes = [
        bande(BORD_INTERIEUR - 1.5 * t, BORD_INTERIEUR - 0.5 * t, exces),
        bande(BORD_INTERIEUR, BORD_INTERIEUR + t),
        bande(BORD_INTERIEUR + t, BORD_INTERIEUR + 2 * t),
        bande(BORD_INTERIEUR + 2 * t, BORD_EXTERIEUR + 0.01),
        bande(BORD_EXTERIEUR + 0.5 * t, BORD_EXTERIEUR + 1.5 * t, exces),
    ]
    tex = np.stack(lignes, axis=1)  # (images, 5, 360, 3)
    n = tex.shape[0]
    img = (np.clip(tex.reshape(n * 5, DEGRES, 3), 0, 1) * 255 + 0.5).astype(np.uint8)
    Path(a.sortie).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, 'RGB').save(a.sortie, lossless=True, quality=100, method=6)

    # Decroissance de la lueur, sur les secteurs ou l'anneau est allume, normee a 1 px du bord.
    allume = bande(BORD_INTERIEUR + t, BORD_INTERIEUR + 2 * t).max(axis=2) > 0.85
    L = exces.max(axis=3)
    def profil(signe: int, n_px: int) -> list[float]:
        valeurs = []
        for d in range(0, n_px + 1):
            r = (BORD_EXTERIEUR + d * t) if signe > 0 else (BORD_INTERIEUR - d * t)
            k = int(np.argmin(abs(rs - r)))
            valeurs.append(float(L[:, :, k][allume].mean()))
        un = valeurs[1]
        return [round(v / un, 3) for v in valeurs]
    print(f'{n} images, centre ({cx:.1f}, {cy:.1f}), texture {img.shape[1]} x {img.shape[0]} -> {a.sortie}')
    print('DECROISSANCE_EXTERIEURE (d = 0..9 px) :', profil(+1, 9))
    for nom, valeurs in lumiere_du_verre(images, cx, cy, np.clip(tex, 0, 1)).items():
        print(f'{nom} (d = 0..{len(valeurs) - 1} px) :', valeurs)
    return 0


#: Les voisinages de la lueur dedans qui eclairent aussi le verre, en degres de part et d'autre.
VOISINAGES = (20, 40)


def flou_circulaire(a: np.ndarray, demi: int) -> np.ndarray:
    """Moyenne glissante sur 2 x demi + 1 colonnes, le tour bouclant sur lui-meme (derniere dimension)."""
    n = a.shape[-1]
    cumul = np.cumsum(np.concatenate([a[..., -demi:], a, a[..., : demi + 1]], axis=-1), axis=-1)
    cumul = np.concatenate([np.zeros_like(cumul[..., :1]), cumul], axis=-1)
    return (cumul[..., 2 * demi + 1 : 2 * demi + 1 + n] - cumul[..., :n]) / (2 * demi + 1)


def lumiere_du_verre(
    images: list[np.ndarray], cx: float, cy: float, tex: np.ndarray
) -> dict[str, list[float]]:
    """La lumiere du VERRE du bouton, du bord interieur de l'anneau jusqu'au centre, en px de bloc.

    Pendant la gerbe, tout le bouton s'eclaire : 33 % d'exces au bord, encore 3 % au centre. Cette
    lumiere vient du secteur allume de l'anneau, mais aussi de ses VOISINS (une gerbe large eclaire le
    verre de biais), et une part COMMUNE a tout le bouton grandit avec la profondeur. A chaque
    profondeur d, moindres carres sur le canal le plus lumineux :
    exces(d) ≈ max(0, local[d] x lueur dedans du meme secteur (ligne 0 de la texture, telle que l'app
                      la lit) + voisins_20[d] et voisins_40[d] x cette lueur moyennee a +-20 et +-40
                      degres + commun[d] x force moyenne de l'anneau sur l'image (tiers du milieu,
                      idem) + seuil[d]).
    Mesure du 2026-11-13 a 10 px : le secteur seul explique R2 = 0,81 et sous-estime les pics de 14 % ;
    avec ses voisins, R2 = 0,94 et les pics tombent juste. Le SEUIL (negatif) garde le verre noir au
    repos : sans lui, une part de la lumiere restait allumee en permanence.
    Le VERRE seul : les points deja clairs au repos (la maison blanche au centre du bouton) sont
    ecartes ; une profondeur sans verre reprend la valeur de la precedente.
    """
    t = PX_DU_BLOC
    profondeurs = int(BORD_INTERIEUR // t)
    th = np.deg2rad(np.arange(0, DEGRES, 2) + 1)
    rs = np.arange(1.0, BORD_INTERIEUR + 1, 1.0)
    X = cx + rs[None, :] * np.sin(th)[:, None]
    Y = cy - rs[None, :] * np.cos(th)[:, None]
    xi, yi = np.round(X).astype(int), np.round(Y).astype(int)
    V = np.stack([im.max(axis=2)[yi, xi] for im in images])  # (images, secteurs, rayons)
    repos = np.percentile(V, 5, axis=0)
    E = np.clip(V - repos[None], 0, None)
    # Les regresseurs, tels que l'app les calcule depuis la texture (puis ramenes a 2 degres).
    dedans = tex[:, 0]  # (images, 360, 3)
    def par_secteur(a: np.ndarray) -> np.ndarray:
        m = a.max(axis=-1)
        return 0.5 * (m[:, 0::2] + m[:, 1::2])
    regresseurs = {'VERRE_LOCAL': par_secteur(dedans)}
    for v in VOISINAGES:
        regresseurs[f'VERRE_VOISINS_{v}'] = par_secteur(np.moveaxis(flou_circulaire(np.moveaxis(dedans, 1, 2), v), 1, 2))
    force = tex[:, 2].max(axis=2).mean(axis=1)
    regresseurs['VERRE_COMMUN'] = np.repeat(force[:, None], E.shape[1], axis=1)
    noms = [*regresseurs, 'VERRE_SEUIL']
    sortie: dict[str, list[float]] = {nom: [] for nom in noms}
    for d in range(profondeurs + 1):
        k = int(np.argmin(abs(rs - (BORD_INTERIEUR - d * t))))
        verre = repos[:, k] < 0.45
        if verre.sum() < 10:
            for nom in noms:
                sortie[nom].append(sortie[nom][-1])
            continue
        A = np.c_[tuple(r[:, verre].ravel() for r in regresseurs.values()) + (np.ones(int(verre.sum()) * E.shape[0]),)]
        coef, *_ = np.linalg.lstsq(A, E[:, verre, k].ravel(), rcond=None)
        for nom, c in zip(noms, coef):
            sortie[nom].append(round(float(c), 4))
    return sortie


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
