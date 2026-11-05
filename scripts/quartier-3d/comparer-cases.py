# Compare deux dossiers de cases rendues, pixel pour pixel (conv-1558) : dit lesquelles diffèrent et de combien.
# Sert à prouver qu'un rendu refait depuis le dépôt redonne les mêmes cases, et à localiser l'écart sinon.
# Usage : python -I comparer-cases.py <dossier-a> <dossier-b> [noms...]   (sans noms : toutes les .png de a)
# Code de sortie : 0 si toutes identiques, 1 sinon, 2 si une case manque d'un côté.
import os, sys
import numpy as np
from PIL import Image

a, b = sys.argv[1], sys.argv[2]
noms = sys.argv[3:] or sorted(f[:-4] for f in os.listdir(a) if f.endswith('.png'))
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
    diff.append((n, f'max {d.max()}, {int((d > 0).sum())} px ({(d > 0).mean():.2%}), >8 : {int((d > 8).sum())} px'))
print(f'{egales}/{len(noms)} identiques au pixel près')
for n, t in diff:
    print('DIFFÉRENTE', n, t)
for n in manque:
    print('MANQUANTE', n)
sys.exit(2 if manque else 1 if diff else 0)
