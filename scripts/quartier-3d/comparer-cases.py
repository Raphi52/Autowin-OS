# Compare deux dossiers de cases rendues, pixel pour pixel (conv-1558) : dit lesquelles diffèrent et de combien.
# Sert à prouver qu'un rendu refait depuis le dépôt redonne les mêmes cases, et à localiser l'écart sinon.
# Usage : python -I comparer-cases.py <dossier-a> <dossier-b> [noms...] [--marquer <dossier>]
#   sans noms : toutes les .png de a ; --marquer : pour chaque case différente, <dossier>/<nom>.png montre la case de b
#   sur fond blanc, ses pixels différents en magenta, et la ligne dit le cadre de l'écart (x et y min-max).
#   C'est ainsi que l'écart des larmes a été localisé dans la fourrure autour des sphères (conv-1558).
# Code de sortie : 0 si toutes identiques, 1 sinon, 2 si une case manque d'un côté.
import os, sys
import numpy as np
from PIL import Image

args = sys.argv[1:]
marquer = None
if '--marquer' in args:
    k = args.index('--marquer')
    marquer = args[k + 1]
    del args[k:k + 2]
    os.makedirs(marquer, exist_ok=True)
a, b = args[0], args[1]
noms = args[2:] or sorted(f[:-4] for f in os.listdir(a) if f.endswith('.png'))
egales, diff, manque = 0, [], []
for n in noms:
    fa, fb = os.path.join(a, n + '.png'), os.path.join(b, n + '.png')
    if not (os.path.exists(fa) and os.path.exists(fb)):
        manque.append(n)
        continue
    pa = np.asarray(Image.open(fa).convert('RGBA')).astype(int)
    pb = np.asarray(Image.open(fb).convert('RGBA')).astype(int)
    if pa.shape == pb.shape and np.array_equal(pa, pb):
        egales += 1
        continue
    if pa.shape != pb.shape:
        diff.append((n, f'tailles {pa.shape} / {pb.shape}'))
        continue
    d = np.abs(pa - pb).max(-1)
    ys, xs = np.nonzero(d)
    texte = f'max {d.max()}, {int((d > 0).sum())} px ({(d > 0).mean():.2%}), >8 : {int((d > 8).sum())} px'
    texte += f', zone x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()}'
    if marquer:
        im = Image.open(fb).convert('RGBA')
        fond = Image.new('RGBA', im.size, (255, 255, 255, 255))
        fond.alpha_composite(im)
        r = np.asarray(fond.convert('RGB')).copy()
        r[d > 0] = (255, 0, 255)
        Image.fromarray(r.astype(np.uint8)).save(os.path.join(marquer, n + '.png'))
    diff.append((n, texte))
print(f'{egales}/{len(noms)} identiques au pixel près')
for n, t in diff:
    print('DIFFÉRENTE', n, t)
for n in manque:
    print('MANQUANTE', n)
sys.exit(2 if manque else 1 if diff else 0)
