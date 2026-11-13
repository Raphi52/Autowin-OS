"""Tests de anneau_lumiere.py, sur des anneaux dessines ici dont on connait la lumiere.

Lance par : python scripts/anneau_lumiere_test.py (code 1 si un cas echoue).
ENTREE QUI DOIT FAIRE ECHOUER : un tour pris dans le sens anti-horaire (l'ordre froid / chaud
s'inverserait), un depart ailleurs qu'a midi, un rectangle deroule sur son bord exterieur au lieu du
milieu du trait, ou des longueurs rendues en secteurs au lieu de parts du tour.
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anneau_lumiere as al  # noqa: E402

ECHECS: list[str] = []
BLANC, CHAUD, FROID = (255, 255, 255), (255, 128, 64), (48, 128, 255)


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


def cercle(dossier: Path, decalage: float) -> Path:
    """Un anneau de rayon 70 : froid de 330 a 360 degres (horaire depuis midi), blanc de 0 a 20,
    chaud de 20 a 50, noir ailleurs ; le tout tourne de `decalage` degres."""
    img = np.zeros((200, 200, 3), np.uint8)
    yy, xx = np.mgrid[0:200, 0:200]
    r = np.hypot(xx - 100, yy - 100)
    angle = (np.degrees(np.arctan2(yy - 100, xx - 100)) + 90 - decalage) % 360  # 0 = midi, horaire
    trait = (r > 65) & (r < 75)
    img[trait & (angle >= 330)] = FROID
    img[trait & (angle < 20)] = BLANC
    img[trait & (angle >= 20) & (angle < 50)] = CHAUD
    chemin = dossier / f'cercle-{decalage:03.0f}.png'
    Image.fromarray(img).save(chemin)
    return chemin


def rect(dossier: Path) -> Path:
    """Un bloc de 300 x 80 a bord de 6 px : sur le bord HAUT, froid de 110 a 140, blanc de 140 a 160,
    chaud de 160 a 190 ; noir ailleurs."""
    img = np.zeros((100, 320, 3), np.uint8)
    x0, y0 = 10, 10
    img[y0:y0 + 6, x0 + 110:x0 + 140] = FROID
    img[y0:y0 + 6, x0 + 140:x0 + 160] = BLANC
    img[y0:y0 + 6, x0 + 160:x0 + 190] = CHAUD
    chemin = dossier / 'rect.png'
    Image.fromarray(img).save(chemin)
    return chemin


with tempfile.TemporaryDirectory() as tmp:
    dossier = Path(tmp)
    images = [cercle(dossier, d) for d in (0, 90, 200)]
    bilan = al.mesurer(images, ('cercle', (100, 100, 70)), 10, 360, 30, silence=True)
    ordre = bilan['ordre_autour_du_blanc']
    verifie(ordre['horaire']['chaud'] == 3 and ordre['horaire']['froid'] == 0,
            f"en tournant dans le sens horaire, le blanc doit etre suivi du chaud : {ordre}")
    verifie(ordre['antihoraire']['froid'] == 3 and ordre['antihoraire']['chaud'] == 0,
            f"dans l'autre sens, du froid : {ordre}")
    verifie(abs(bilan['blanc_median_part_du_tour'] - 20 / 360) < 0.01,
            f"blanc de 20 degres : {bilan['blanc_median_part_du_tour']}")
    verifie(abs(bilan['frange_mediane_part_du_tour']['chaud'] - 30 / 360) < 0.012,
            f"frange chaude de 30 degres : {bilan['frange_mediane_part_du_tour']}")
    verifie(abs(bilan['parts']['blanc'] - 20 / 360) < 0.01, f"part de blanc : {bilan['parts']}")
    verifie(bilan['palette']['chaud']['vive'] == '#ff8040', f"palette chaude : {bilan['palette']}")

    # Le depart a midi : un blanc centre a 10 degres se lit a 12h.
    pts, _ = al.contour_cercle(100, 100, 70, 360)
    verifie(abs(pts[0][0] - 100) < 1e-6 and pts[0][1] < 100, f"le tour part de midi : {pts[0]}")
    verifie(pts[90][0] > 100, f"un quart de tour plus loin, on est a 3h : {pts[90]}")

    # Rectangle : le bord haut se parcourt vers la droite (sens horaire), depuis son milieu.
    b = al.mesurer([rect(dossier)], ('rect', (10, 10, 300, 80, 12)), 6, 720, 30, silence=True)
    o = b['ordre_autour_du_blanc']
    verifie(o['horaire']['chaud'] == 1 and o['antihoraire']['froid'] == 1,
            f"bord haut : froid a gauche du blanc, chaud a droite : {o}")
    tour = 2 * (300 - 6) + 2 * (80 - 6) - (8 - 2 * math.pi) * (12 - 3)
    verifie(abs(b['blanc_median_part_du_tour'] - 20 / tour) < 0.004,
            f"blanc de 20 px sur un tour de {tour:.0f} px : {b['blanc_median_part_du_tour']}")
    pr, _ = al.contour_rect(10, 10, 300, 80, 12, 720)
    verifie(abs(pr[0][0] - 160) < 0.5 and abs(pr[0][1] - 10) < 1e-6, f"depart au milieu du bord haut : {pr[0]}")

if ECHECS:
    print('\n'.join(f'ECHEC : {e}' for e in ECHECS))
    sys.exit(1)
print('anneau_lumiere : tous les cas passent')
