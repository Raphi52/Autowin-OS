# Longueur relative du poil par sommet (conv-1558) : 1 partout, sauf au bout de la queue où elle descend à 0,3.
# Sans ça, la touffe du bout dépasse de 29 px (rendu 600) à gauche de la case dans les vues de profil.
# Usage : python queue-effilee.py b3d/v3-hd.json b3d/base-v3.queue.bin
import base64, gzip, json, sys
import numpy as np
M = json.load(open(sys.argv[1]))
nv = M['nv']
z = gzip.decompress(base64.b64decode(M['d']))
pos = np.stack([np.frombuffer(z, np.int16, nv, 2 * nv * i) for i in range(3)], 1) / M['ech']
G = np.frombuffer(z, np.uint8, nv, 12 * nv)   # positions 6 o, normales 3 o, couleurs 3 o par sommet
queue = G == 0
zq = -pos[queue, 2]
# Début et fin de l'effilage (z, arg. 3) et part gardée au bout (arg. 4) : 0,30 et 0,3 par défaut ;
# le kendo, dont la case est décalée de 32 px vers l'avant, prend 0,22 et 0 (conv-1558).
Z0 = float(sys.argv[3]) if len(sys.argv) > 3 else .30
BOUT = float(sys.argv[4]) if len(sys.argv) > 4 else .3
# Une queue qui ne dépasse pas Z0 (le panda, conv-1558) ne s'effile pas : sans le plancher, le dénominateur négatif
# retournait le signe et raccourcissait TOUTE la queue au bout.
t = np.clip((zq - Z0) / max(zq.max() - Z0, 1e-6), 0, 1)
Q = np.ones(nv, np.float32)
Q[queue] = 1 - (1 - BOUT) * t
Q.tofile(sys.argv[2])
print('queue', queue.sum(), 'sommets, bout à z =', round(float(-zq.max()), 3), ', effilés :', int((t > 0).sum()))
