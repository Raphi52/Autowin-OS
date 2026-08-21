"""Compte les pixels NON NOIRS d'une zone d'une capture.

Sert d'oracle au decor 3D de la page d'Accueil : un canevas peut exister, porter un contexte WebGL et
ne RIEN dessiner. La capture est la seule autorite sur ce point, et c'est aussi ce que voit
l'utilisateur.

    python scripts/mesure-pixels-allumes.py <capture.png> <fractionX> <fractionY>

Sortie : « <pixels de la zone> <pixels allumes> ».
"""
import sys

from PIL import Image

image = Image.open(sys.argv[1]).convert("RGB")
width, height = image.size
left = int(width * float(sys.argv[2]))
top = int(height * float(sys.argv[3]))
zone = list(image.crop((left, top, width, height)).getdata())
# Seuil a 18 sur la somme RVB : au-dessus du bruit de compression PNG, tres en dessous d'une etoile.
allumes = sum(1 for r, g, b in zone if r + g + b > 18)
print(len(zone), allumes)
