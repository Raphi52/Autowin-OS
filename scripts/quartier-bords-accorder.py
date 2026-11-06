"""
ACCORDE LES BORDS PROLONGÉS DE L'ACCUEIL (bords.avif) À LA PEINTURE ACTUELLE (falaise.avif) — conv-1644.

Pourquoi : au zoom, l'Accueil pose `bords.avif` à gauche et à droite de la peinture. Les bords avaient été
peints pour l'ancienne Falaise ; la peinture a été repeinte le 04/11 (16104dda8, même composition) et les
teintes ne collaient plus : une couture visible dans l'eau et le ponton au zoom sur le robot.

Comment : le dessin des bords est gardé tel quel ; seule une correction douce s'y ajoute. Elle vaut, sur la
colonne de jointure, l'écart exact avec la peinture, et s'étale vers l'extérieur comme une fonction
harmonique (raccord « sans couture » de Pérez et al., 2003). Les écarts de détail s'éteignent en quelques
pixels, l'écart de teinte s'étale sur toute la largeur du bord.

Usage :
  python -I scripts/quartier-bords-accorder.py --mesurer            # écart à la jointure, rien n'est écrit
  python -I scripts/quartier-bords-accorder.py [--qualite 80]       # réécrit bords.avif, puis mesure
Code de sortie : 0 ; 3 si, après écriture, la jointure reste plus marquée que l'écart naturel de la peinture.
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy.fft import dct, idct

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOSSIER = os.path.join(RACINE, "src", "renderer", "src", "assets", "quartier")
# Même valeur que TAMPON_BORDS de src/renderer/src/quartier/quartier-zoom.ts.
TAMPON = 16


def lire(nom):
    return np.asarray(Image.open(os.path.join(DOSSIER, nom)).convert("RGB")).astype(np.float64)


def ecart(a, b, lissage=16):
    """Écart de couleur moyen par ligne entre deux bandes de colonnes, lissé verticalement : (moyenne, p95)."""
    noyau = np.ones(lissage) / lissage
    ma = np.stack([np.convolve(a.mean(1)[:, c], noyau, "same") for c in range(3)], 1)
    mb = np.stack([np.convolve(b.mean(1)[:, c], noyau, "same") for c in range(3)], 1)
    e = np.abs(ma - mb).mean(1)
    return float(e.mean()), float(np.percentile(e, 95))


def mesurer(bords, peinture):
    l = (bords.shape[1] - TAMPON) // 2
    gauche, droite = bords[:, :l], bords[:, l + TAMPON :]
    return {
        "gauche": ecart(gauche[:, -8:], peinture[:, :8]),
        "droite": ecart(droite[:, :8], peinture[:, -8:]),
        # Deux bandes de 8 colonnes, voisines, DANS la peinture : l'écart naturel d'une image sans couture.
        "naturel": ecart(peinture[:, 8:16], peinture[:, 16:24]),
    }


def correction_harmonique(bande, cible):
    """
    `bande` : le bord, la jointure sur sa DERNIÈRE colonne. Rend bande + c, où c est harmonique, vaut
    exactement `cible - bande[:, -1]` sur la jointure, et ne force rien sur les trois autres côtés (Neumann).
    Résolu fréquence par fréquence le long de la hauteur (DCT) : chaque fréquence k décroît vers l'extérieur
    en cosh(μ_k (x + 1/2)) / cosh(μ_k (s + 1/2)), avec r + 1/r = 2 + λ_k et μ_k = ln r.
    """
    h, w, _ = bande.shape
    s = w - 1
    g = cible - bande[:, -1]
    gk = dct(g, type=2, axis=0, norm="ortho")
    k = np.arange(h)
    lam = 2.0 - 2.0 * np.cos(np.pi * k / h)
    r = ((2.0 + lam) + np.sqrt((2.0 + lam) ** 2 - 4.0)) / 2.0
    mu = np.log(r)[:, None]
    x = np.arange(w)[None, :]
    # cosh(μ(x+½)) / cosh(μ(s+½)), écrit sans débordement pour les grandes fréquences.
    rapport = np.exp(mu * (x - s)) * (1.0 + np.exp(-2.0 * mu * (x + 0.5))) / (
        1.0 + np.exp(-2.0 * mu * (s + 0.5))
    )
    c = np.empty_like(bande)
    for canal in range(3):
        c[:, :, canal] = idct(gk[:, canal][:, None] * rapport, type=2, axis=0, norm="ortho")
    return bande + c


def accorder(bords, peinture):
    l = (bords.shape[1] - TAMPON) // 2
    gauche = correction_harmonique(bords[:, :l], peinture[:, 0])
    # À droite, la jointure est la PREMIÈRE colonne du bord : on retourne, on corrige, on remet.
    droite = correction_harmonique(bords[:, l + TAMPON :][:, ::-1], peinture[:, -1])[:, ::-1]
    sortie = bords.copy()
    sortie[:, :l] = gauche
    sortie[:, l + TAMPON :] = droite
    # Le tampon répète la dernière colonne de chaque bord : le lissage n'y lit rien d'étranger.
    sortie[:, l : l + TAMPON // 2] = gauche[:, -1:]
    sortie[:, l + TAMPON // 2 : l + TAMPON] = droite[:, :1]
    return np.clip(np.rint(sortie), 0, 255).astype(np.uint8)


def afficher(titre, m):
    print(
        f"{titre} : gauche moy {m['gauche'][0]:.1f} p95 {m['gauche'][1]:.1f} | "
        f"droite moy {m['droite'][0]:.1f} p95 {m['droite'][1]:.1f} | "
        f"naturel moy {m['naturel'][0]:.1f} p95 {m['naturel'][1]:.1f}"
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mesurer", action="store_true")
    p.add_argument("--qualite", type=int, default=80)
    p.add_argument("--sortie", default=os.path.join(DOSSIER, "bords.avif"))
    a = p.parse_args()
    bords = lire("bords.avif")
    image_peinture = Image.open(os.path.join(DOSSIER, "falaise.avif")).convert("RGB")
    # La peinture est agrandie à la finesse des bords : ils n'ont pas la même (×2 contre ×4 au 06/11).
    hauteur = bords.shape[0]
    largeur = round(image_peinture.width * hauteur / image_peinture.height)
    peinture = np.asarray(image_peinture.resize((largeur, hauteur), Image.LANCZOS)).astype(np.float64)
    avant = mesurer(bords, peinture)
    afficher("avant", avant)
    if a.mesurer:
        return 0
    Image.fromarray(accorder(bords, peinture)).save(a.sortie, quality=a.qualite)
    apres = mesurer(np.asarray(Image.open(a.sortie).convert("RGB")).astype(np.float64), peinture)
    afficher("apres", apres)
    print(f"ecrit : {a.sortie} ({os.path.getsize(a.sortie)} octets)")
    naturel = apres["naturel"][0]
    return 0 if max(apres["gauche"][0], apres["droite"][0]) <= naturel else 3


if __name__ == "__main__":
    sys.exit(main())
