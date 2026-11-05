# L'atlas v3 d'un animal en ×M (conv-1558, 2026-11-05) : les 28 rangées d'un coup, même ordre, mêmes nombres
# d'images, mêmes décalages et même traitement de case qu'atlas-plus.py puis atlas-plante.py (conv-1446/renard),
# mais lues dans des rendus de 300·M px et réduites en cases de 126·M × 170·M. Une seule génération AVIF.
# Les cases à visage (liste-visages.txt) : le bain (rangée 13, content chez le tanuki), puis le bain endormi (26) et la
# surprise (27), ajoutés pour « happy when a task finishes, surprised on an error, sleepy when nothing is running ».
# Usage : python atlas-v3.py <f-base> <f-plus> <f-plante> <f-visages> <sortie.avif> [M=2]   (QA = qualité AVIF, 62 par défaut)
import io, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BASE, PLUS, PLANTE, VISAGES = (d.rstrip('/') + '/' for d in sys.argv[1:5])
SORTIE = sys.argv[5]
M = int(sys.argv[6]) if len(sys.argv) > 6 else 2
K = .62
X0, Y0, X1, Y1 = 45, 25, 248, 299          # recadrage dans un rendu de 300 px (atlas.py, conv-1428)
COLS = 12
lig = [[BASE + f'm{y}-{i}.png' for i in range(8)] + [BASE + f'm{y}-d.png'] for y in (0, 45, 90, 135, 180)]
lig += [[PLUS + f'{g}-{i}.png' for i in range(12)] for g in ('ma', 'pi', 'li', 'sa')]
lig += [[PLUS + f'pa-{i}.png' for i in range(12)]]
lig += [[PLUS + f'{e}-{i}.png' for i in range(12)] for e in ('as', 'at', 'pl')]
lig += [[VISAGES + f'ba-{i}.png' for i in range(12)]]
lig.append([BASE + f'me-{i}.png' for i in range(12)])
NOUVEAUX = dict(mee=6, the=6, th=12, boe=6, bo=12, ra=12, ar=12, ke=12)
for g, n in NOUVEAUX.items():
    lig.append([(PLUS if g in ('bo', 'ra', 'ar', 'ke') else BASE) + f'{g}-{i}.png' for i in range(n)])
lig += [[PLANTE + f'{g}-{i}.png' for i in range(12)] for g in ('pr', 'fu', 'bi')]
lig += [[VISAGES + f'{g}-{i}.png' for i in range(12)] for g in ('bz', 'su')]
assert len(lig) == 28, len(lig)
DECALE = dict(ra=20, ar=12, ke=32)          # le râteau, l'arrosoir et le sabre dépassent devant lui
cw, ch = round((X1 - X0) * K), round((Y1 - Y0) * K)
CW, CH = cw * M, ch * M
at = np.zeros((CH * len(lig), CW * COLS, 4))
bords, manquants = [], []
for j, r in enumerate(lig):
    for i, f in enumerate(r):
        if not os.path.exists(f):
            manquants.append(os.path.basename(f))
            continue
        im = np.asarray(Image.open(f).convert('RGBA')).astype(float) / 255
        k = im.shape[1] / 300
        g = os.path.basename(f).split('-')[0]
        sh = DECALE.get(g, 0) if 14 <= j < 23 else 0
        x0, y0, x1, y1, s = (round(v * k) for v in (X0, Y0, X1, Y1, sh))
        c = im[y0:y1, x0 + s:x1 + s].copy()
        if c.shape[1] < x1 - x0:
            c = np.pad(c, ((0, 0), (0, x1 - x0 - c.shape[1]), (0, 0)))
        hors = im[..., 3].copy()
        hors[y0:y1, x0 + s:x1 + s] = 0
        if hors.max() > .05:
            bords.append((os.path.basename(f), round(float(hors.max()), 2)))
        c[..., :3] *= c[..., 3:]
        p = np.asarray(Image.fromarray((c * 255).astype(np.uint8), 'RGBA').resize((CW, CH), Image.LANCZOS)).astype(float) / 255
        p[..., :3] = np.clip(p[..., :3] / np.maximum(p[..., 3:], 1e-3), 0, 1)
        vide = p[..., 3] < .5
        if vide.any() and (~vide).any():
            ind = ndi.distance_transform_edt(vide, return_distances=False, return_indices=True)
            p[..., :3] = p[..., :3][ind[0], ind[1]]
        at[j * CH:(j + 1) * CH, i * CW:(i + 1) * CW] = p
if manquants and not os.environ.get('PARTIEL'):
    sys.exit(f'{len(manquants)} images manquantes : {manquants[:12]}')
b = io.BytesIO()
Image.fromarray((at * 255).astype(np.uint8), 'RGBA').save(b, 'AVIF', quality=int(os.environ.get('QA', 62)), speed=4)
with open(SORTIE, 'wb') as f:
    f.write(b.getvalue())
ANC = dict(cw=cw, ch=ch, ax=(150 - X0) * K, ay=(150 + .47 * .866 * 227.3 - Y0) * K, pu=227.3 * K)
print('atlas', at.shape, len(b.getvalue()), 'octets, finesse', M, 'ancres (grille ×1)', json.dumps(ANC))
print('coupés au bord de la case :', bords if bords else 'aucun')
