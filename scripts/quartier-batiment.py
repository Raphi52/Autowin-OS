"""Remplace UN bâtiment du décor de l'Accueil sans toucher au reste (conv-1534).

Depuis conv-1534, chaque bâtiment de la Falaise a sa propre image :
  src/renderer/src/assets/quartier/batiments/<nom>.webp
posée au chargement sur la peinture et sur `falaise-derriere.webp` (voir quartier-calques.ts). Changer un
bâtiment = générer SA nouvelle image (fond transparent, même style), puis lancer ce script : il installe
l'image et met à jour l'entrée du bâtiment dans donnees.json (place, taille, forme pour la souris et pour
cacher les tanukis qui passent derrière, ligne de pied). Rien d'autre ne bouge.

Usage :
  python -I scripts/quartier-batiment.py --liste
  python -I scripts/quartier-batiment.py <nom> <image.png> [--echelle 1.0] [--x X --y Y] [--pieds garder|recalculer]

  <nom>       le `n` ou la `cle` du bâtiment (voir --liste), ex. chat, knowledge, t_phare
  <image>     PNG ou WebP AVEC transparence ; ses pixels sont ceux de la peinture (2 par pixel d'Accueil)
  --echelle   agrandit ou réduit l'image avant de la poser
  --x --y     coin haut-gauche en pixels d'Accueil (1344 × 768) ; par défaut, la nouvelle image est posée
              sur le même pied que l'ancienne (centre du bas au même endroit)
  --pieds     `recalculer` (défaut si la place ou la taille change) ou `garder` la ligne de pied relevée

Pièces animées : `roue`, `roueFond`, `roueMoyeu` (la roue de Settings, dans vie.calques de donnees.json) se
remplacent de la même façon, `<nom>` = le nom de la pièce. Elles gardent leur place et leur taille (la roue
tourne autour du centre de son image) : l'image est mise à leur taille si ses proportions sont les mêmes.
Le mât, sous le disque de la roue, est le bâtiment `settings` ; `roueFond` n'est que le bout de mât derrière
la roue (transparent ailleurs : le ballon passe derrière la roue et se voit entre ses rayons).

Limites : un bâtiment qui a une zone de clic à part (`mh`) la garde. Là où l'ancien bâtiment ne sera plus recouvert,
on voit `falaise-derriere.webp` : le script dit quelle part de l'ancienne empreinte se découvre.
Dépendances : Pillow (avec WebP), numpy.
"""
import argparse
import base64
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUARTIER = os.path.join(RACINE, 'src', 'renderer', 'src', 'assets', 'quartier')
DONNEES = os.path.join(QUARTIER, 'donnees.json')
BATIMENTS = os.path.join(QUARTIER, 'batiments')
S = 2  # pixels de peinture par pixel d'Accueil (falaise.avif fait 2688 × 1536 pour 1344 × 768)
PAS_PIED = 8  # une valeur de ligne de pied tous les 8 px d'Accueil (quartier-scene.ts, `pied`)


def nom_de(o):
    return o.get('n') or o.get('cle')


def lire_donnees():
    with open(DONNEES, 'rb') as f:
        return json.loads(f.read().decode('utf8'))


def ecrire_donnees(D):
    # Même écriture que l'original (une ligne, UTF-8 brut, sans fin de ligne) : vérifié octet pour octet.
    # Texte fabriqué AVANT d'ouvrir le fichier, puis remplacement d'un bloc : une erreur ne le vide jamais.
    octets = json.dumps(D, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    with open(DONNEES + '.tmp', 'wb') as f:
        f.write(octets)
    os.replace(DONNEES + '.tmp', DONNEES)


def forme_data_url(alpha):
    """La forme du bâtiment, comme les autres de donnees.json : une image WebP dont seule la transparence compte."""
    rgba = np.zeros(alpha.shape + (4,), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = alpha
    tampon = io.BytesIO()
    Image.fromarray(rgba, 'RGBA').save(tampon, 'WEBP', lossless=True, quality=100, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(tampon.getvalue()).decode('ascii')


def rogner(rgba):
    """L'image sans ses marges entièrement transparentes (couleur des pixels transparents remise à zéro)."""
    rgba = rgba.copy()
    rgba[rgba[..., 3] == 0, :3] = 0
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    if not len(ys):
        return None
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def ligne_de_pied(alpha, x, y, w):
    """Pour chaque tranche de 8 px d'Accueil, le bas du bâtiment (dernier pixel opaque), en px d'Accueil."""
    n = math.ceil(w / PAS_PIED) + 1
    valeurs = []
    for i in range(n):
        c0 = max(0, (i * PAS_PIED - PAS_PIED // 2) * S)
        c1 = min(alpha.shape[1], (i * PAS_PIED + PAS_PIED // 2) * S)
        lignes = np.nonzero((alpha[:, c0:c1] > 128).any(1))[0] if c1 > c0 else []
        valeurs.append(round(y + (lignes.max() + 1) / S) if len(lignes) else None)
    connues = [i for i, v in enumerate(valeurs) if v is not None]
    if not connues:
        sys.exit('image entièrement transparente')
    # Une tranche vide prend la valeur de la tranche connue la plus proche.
    return [v if v is not None else valeurs[min(connues, key=lambda k: abs(k - i))] for i, v in enumerate(valeurs)]


def poser_piece(D, a):
    """Remplace une pièce animée de vie.calques (la roue de Settings) à sa place et à sa taille (conv-1534).

    La pièce n'a ni pied ni forme de clic : seule son image change. Sa place ne bouge pas, car la roue tourne
    autour du centre de son image (px, py) et le moyeu doit rester sur cet axe (quartier-vie.test.ts).
    """
    if a.x is not None or a.y is not None or a.pieds:
        sys.exit("une pièce animée garde sa place : --x, --y et --pieds ne s'appliquent pas")
    c = D['vie']['calques'][a.nom]
    im = Image.open(a.image)
    if 'A' not in im.getbands():
        sys.exit("l'image n'a pas de transparence : la pièce doit être détourée (fond transparent)")
    im = im.convert('RGBA')
    if a.echelle != 1.0:
        im = im.resize((max(1, round(im.width * a.echelle)), max(1, round(im.height * a.echelle))), Image.LANCZOS)
    attendu = (round(c['w'] * S), round(c['h'] * S))
    if im.size != attendu:
        if abs(im.width / im.height - attendu[0] / attendu[1]) > 0.02:
            sys.exit(f"{a.nom} : proportions différentes ({im.width}×{im.height} pour {attendu[0]}×{attendu[1]})")
        im = im.resize(attendu, Image.LANCZOS)
    actuelle = Image.open(io.BytesIO(base64.b64decode(c['m'].split(',')[1]))).convert('RGBA')
    if np.array_equal(np.asarray(actuelle), np.asarray(im)):
        print(f"{a.nom} : même image que l'actuelle, rien à changer")
        return
    tampon = io.BytesIO()
    im.save(tampon, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    c['m'] = 'data:image/webp;base64,' + base64.b64encode(tampon.getvalue()).decode('ascii')
    ecrire_donnees(D)
    print(f"{a.nom} posé : x={c['x']} y={c['y']} {c['w']}×{c['h']} (place et taille inchangées)")
    print("à vérifier : npx vitest run src/renderer/src/quartier/ ; puis regarder l'Accueil")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('nom', nargs='?')
    p.add_argument('image', nargs='?')
    p.add_argument('--liste', action='store_true')
    p.add_argument('--echelle', type=float, default=1.0)
    p.add_argument('--x', type=float)
    p.add_argument('--y', type=float)
    p.add_argument('--pieds', choices=['garder', 'recalculer'])
    a = p.parse_args()
    D = lire_donnees()

    if a.liste:
        for o in D['obj']:
            print(f"{nom_de(o):18} {o.get('nom', ''):24} x={o['x']} y={o['y']} {o['w']}×{o['h']}")
        for n, c in D['vie']['calques'].items():
            print(f"{n:18} {'pièce animée':24} x={c['x']} y={c['y']} {c['w']}×{c['h']}")
        return
    if not a.nom or not a.image:
        p.error('il faut <nom> et <image> (ou --liste)')
    if a.nom in D['vie']['calques']:
        poser_piece(D, a)
        return

    o = next((q for q in D['obj'] if nom_de(q) == a.nom), None)
    if o is None:
        sys.exit(f"bâtiment inconnu : {a.nom} (voir --liste)")
    im = Image.open(a.image)
    if 'A' not in im.getbands():
        sys.exit("l'image n'a pas de transparence : le bâtiment doit être détouré (fond transparent)")
    im = im.convert('RGBA')
    if a.echelle != 1.0:
        im = im.resize((max(1, round(im.width * a.echelle)), max(1, round(im.height * a.echelle))), Image.LANCZOS)
    neuf = rogner(np.asarray(im))
    if neuf is None:
        sys.exit('image entièrement transparente')
    hp, wp = neuf.shape[:2]

    # La nouvelle image se pose sur le pied de l'ANCIEN bâtiment visible (centre du bas de sa forme, pas de
    # son cadre, qui a des marges) : la même image réinstallée retombe au pixel près.
    vieille = np.asarray(Image.open(io.BytesIO(base64.b64decode(o['m'].split(',')[1]))).convert('RGBA'))[..., 3] > 0
    vy, vx = np.nonzero(vieille)
    if a.x is not None or a.y is not None:
        px0 = round((a.x if a.x is not None else o['x']) * S)
        py0 = round((a.y if a.y is not None else o['y']) * S)
    else:
        px0 = o['x'] * S + vx.min() + math.floor((vx.max() + 1 - vx.min() - wp) / 2)
        py0 = o['y'] * S + vy.max() + 1 - hp
    # Coin en pixels d'Accueil entiers ; le pixel de peinture restant devient une marge dans l'image.
    px0, py0 = int(px0), int(py0)  # entiers Python : json refuse ceux de numpy
    x, y = px0 // S, py0 // S
    ox, oy = px0 - x * S, py0 - y * S
    w, h = math.ceil((ox + wp) / S), math.ceil((oy + hp) / S)
    rgba = np.zeros((h * S, w * S, 4), np.uint8)
    rgba[oy:oy + hp, ox:ox + wp] = neuf
    if x < 0 or y < 0 or x + w > 1344 or y + h > 768:
        sys.exit(f"le bâtiment sortirait de la peinture : x={x} y={y} {w}×{h} (1344 × 768)")

    actuel = os.path.join(BATIMENTS, a.nom + '.webp')
    if os.path.exists(actuel) and a.x is None and a.y is None:
        avant = rogner(np.asarray(Image.open(actuel).convert('RGBA')))
        if avant is not None and avant.shape == neuf.shape and np.array_equal(avant, neuf):
            print(f"{a.nom} : même image que l'actuelle, rien à changer")
            return

    ancien = {k: o[k] for k in ('x', 'y', 'w', 'h')}
    # Part de l'ancienne empreinte qui ne sera plus recouverte (on y verra falaise-derriere.webp).
    couverte = np.zeros_like(vieille)
    dx, dy = (x - o['x']) * S, (y - o['y']) * S
    ya, yb = max(0, dy), min(vieille.shape[0], dy + h * S)
    xa, xb = max(0, dx), min(vieille.shape[1], dx + w * S)
    if ya < yb and xa < xb:
        couverte[ya:yb, xa:xb] = rgba[ya - dy:yb - dy, xa - dx:xb - dx, 3] > 0
    decouverte = float((vieille & ~couverte).sum()) / max(1, int(vieille.sum()))

    # Même forme au même endroit (retouche de couleurs) : la ligne de pied relevée à la main reste juste.
    meme_forme = not (vieille & ~couverte).any() and int(couverte.sum()) == int((rgba[..., 3] > 0).sum())
    pieds = a.pieds or ('garder' if meme_forme else 'recalculer')
    Image.fromarray(rgba, 'RGBA').save(os.path.join(BATIMENTS, a.nom + '.webp'), 'WEBP',
                                       lossless=True, quality=100, method=6, exact=True)
    o.update(x=x, y=y, w=w, h=h, m=forme_data_url(rgba[..., 3]))
    if pieds == 'recalculer':
        o['b'] = ligne_de_pied(rgba[..., 3], x, y, w)
    ecrire_donnees(D)

    print(f"{a.nom} posé : x={x} y={y} {w}×{h} (avant x={ancien['x']} y={ancien['y']} {ancien['w']}×{ancien['h']})")
    print(f"ligne de pied : {pieds}")
    print(f"ancienne empreinte découverte : {decouverte * 100:.0f} % (on y voit falaise-derriere.webp)")
    if o.get('mh'):
        print("attention : ce bâtiment a une zone de clic à part (mh), gardée telle quelle")
    if a.nom == 'settings':
        print("attention : la roue qui tourne a ses propres pièces (roue, roueFond, roueMoyeu), non touchées ici")
    print("à vérifier : npx vitest run src/renderer/src/quartier/ ; puis regarder l'Accueil")


if __name__ == '__main__':
    main()
