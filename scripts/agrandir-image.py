"""Agrandit une image par un modèle Real-ESRGAN, sur CPU, par tuiles (conv-1468).

Né pour le décor de l'Accueil : la peinture `falaise.avif` (2688×1536) devenait floue au zoom.
Usage : python -I scripts/agrandir-image.py <entree> <sortie.png> --modele <poids.pth> [--tuile 256]
Les poids se téléchargent depuis https://github.com/xinntao/Real-ESRGAN/releases (x2plus, x4plus).
Dépendance : pip install spandrel (torch déjà requis).
"""
import argparse

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader


def agrandir(img: Image.Image, modele, tuile: int, recouvrement: int = 16) -> Image.Image:
    a = np.asarray(img.convert('RGB'), dtype=np.float32) / 255.0
    h, w, _ = a.shape
    s = modele.scale
    sortie = np.zeros((h * s, w * s, 3), dtype=np.float32)
    for y in range(0, h, tuile):
        for x in range(0, w, tuile):
            # Tuile élargie pour éviter les coutures, puis on ne garde que son cœur.
            y0, x0 = max(0, y - recouvrement), max(0, x - recouvrement)
            y1, x1 = min(h, y + tuile + recouvrement), min(w, x + tuile + recouvrement)
            t = torch.from_numpy(a[y0:y1, x0:x1].transpose(2, 0, 1)).unsqueeze(0)
            with torch.no_grad():
                r = modele(t).squeeze(0).clamp(0, 1).numpy().transpose(1, 2, 0)
            cy, cx = (y - y0) * s, (x - x0) * s
            hh, ww = (min(h, y + tuile) - y) * s, (min(w, x + tuile) - x) * s
            sortie[y * s:y * s + hh, x * s:x * s + ww] = r[cy:cy + hh, cx:cx + ww]
    return Image.fromarray((sortie * 255 + 0.5).astype(np.uint8))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('entree')
    p.add_argument('sortie')
    p.add_argument('--modele', required=True)
    p.add_argument('--tuile', type=int, default=256)
    a = p.parse_args()
    torch.set_num_threads(max(1, torch.get_num_threads()))
    modele = ModelLoader().load_from_file(a.modele).eval()
    agrandir(Image.open(a.entree), modele, a.tuile).save(a.sortie)
    print(a.sortie)


if __name__ == '__main__':
    main()
