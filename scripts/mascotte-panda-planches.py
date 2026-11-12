"""Assemble les images du panda boss en planches pour la mascotte du bureau.

Le panda boss (lunettes-ecran, chaine et medaillon d'or) est modele en three.js : sa scene d'export
est rendue par `scripts/mascotte-panda-rendu.mjs`, une image par numero (`f-001.png` ... `f-064.png`,
fond transparent, 384x384 : le double de la planche, reduit ici pour un poil et des lunettes plus
nets). Ce script les colle par geste en planches de 16 images de 192x192 cote a cote, en WebP, et
ecrit le module TypeScript que la page de la mascotte embarque. La fenetre de la mascotte n'admet
aucun script : la 3D y est rejouee en CSS, par `steps(16)`.

Usage : python scripts/mascotte-panda-planches.py <dossier des f-NNN.png> [--apercu <dossier>]
"""

import base64
import io
import sys
from pathlib import Path

from PIL import Image

# Un geste par etat de la mascotte, dans l'ordre de `window.exporter.gestes` : 16 images chacun.
GESTES = ["REPOS", "TRAVAIL", "ATTENTE", "SOUCI"]
IMAGES_PAR_GESTE = 16
LARGEUR, HAUTEUR = 192, 192
RACINE = Path(__file__).resolve().parent.parent
MODULE = RACINE / "src" / "main" / "mascotte" / "mascotte-panda-images.ts"

ENTETE = """/**
 * Les planches du PANDA BOSS : modele en three.js (fourrure, lunettes-ecran, medaillon), rendu par
 * `scripts/mascotte-panda-rendu.mjs` en 16 images par geste (192x192, WebP), cote a cote. La fenetre
 * de la mascotte n'admet aucun script : la 3D y est donc rejouee en CSS, par `steps(16)`. Genere par
 * `scripts/mascotte-panda-planches.py` — ne pas editer a la main.
 */
"""


# Pas d'etirement des tons : le rendu three.js couvre deja toute la plage (luminance des pixels
# opaques du repos : 1er centile 0, 99e centile 241). L'etirement 45-220 fait pour la panda de
# Blender, peu contrastee, y bouchait les noirs et brulait le blanc du pelage.


# Un dessin qui touche le bord du cadre est un dessin coupe : dans un cadre de 160 px, les manches
# larges du kimono l'ont ete sur 26 images sans que rien ne le dise. Opaque au bord = coupe franche
# (le script refuse d'ecrire) ; a demi transparent = le dessin frole le bord (il previent).
BORD_COUPE, BORD_FROLE = 200, 40
BORDS = (
    (0, 0, 1, HAUTEUR),
    (LARGEUR - 1, 0, LARGEUR, HAUTEUR),
    (0, 0, LARGEUR, 1),
    (0, HAUTEUR - 1, LARGEUR, HAUTEUR),
)


def opacite_au_bord(image: Image.Image) -> int:
    alpha = image.getchannel("A")
    return max(max(alpha.crop(bord).tobytes()) for bord in BORDS)


def a_la_taille(image: Image.Image, nom: str) -> Image.Image:
    """Rend l'image a la taille de la planche : telle quelle, ou reduite d'un facteur entier."""
    if image.size == (LARGEUR, HAUTEUR):
        return image
    facteur = image.size[0] // LARGEUR
    if facteur < 2 or image.size != (LARGEUR * facteur, HAUTEUR * facteur):
        raise SystemExit(f"{nom} : {image.size}, attendu un multiple entier de {(LARGEUR, HAUTEUR)}")
    # « RGBa » = couleurs deja multipliees par la transparence : sans cela, la reduction melange le
    # noir invisible du fond aux bords du dessin et les cerne de sombre.
    return image.convert("RGBa").resize((LARGEUR, HAUTEUR), Image.LANCZOS).convert("RGBA")


def planche(dossier: Path, rang: int, au_bord: dict[int, int]) -> Image.Image:
    feuille = Image.new("RGBA", (LARGEUR * IMAGES_PAR_GESTE, HAUTEUR), (0, 0, 0, 0))
    for i in range(IMAGES_PAR_GESTE):
        numero = rang * IMAGES_PAR_GESTE + i + 1
        nom = f"f-{numero:03d}.png"
        image = a_la_taille(Image.open(dossier / nom).convert("RGBA"), nom)
        au_bord[numero] = opacite_au_bord(image)
        feuille.paste(image, (i * LARGEUR, 0))
    return feuille


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dossier = Path(sys.argv[1])
    apercu = Path(sys.argv[sys.argv.index("--apercu") + 1]) if "--apercu" in sys.argv else None
    lignes = [ENTETE]
    au_bord: dict[int, int] = {}
    for rang, geste in enumerate(GESTES):
        feuille = planche(dossier, rang, au_bord)
        tampon = io.BytesIO()
        feuille.save(tampon, "WEBP", quality=82, method=6)
        if apercu:
            apercu.mkdir(parents=True, exist_ok=True)
            feuille.save(apercu / f"planche-{geste.lower()}.png")
        donnees = base64.b64encode(tampon.getvalue()).decode("ascii")
        lignes.append(f"export const PANDA_{geste} =\n  'data:image/webp;base64,{donnees}'\n")
        print(f"{geste}: {len(tampon.getvalue())} octets")
    frolent = sorted(n for n, v in au_bord.items() if BORD_FROLE <= v < BORD_COUPE)
    coupees = sorted(n for n, v in au_bord.items() if v >= BORD_COUPE)
    if frolent:
        print(f"frolent le bord du cadre : {frolent}")
    if coupees:
        raise SystemExit(f"images coupees par le bord du cadre : {coupees} - elargir le rendu")
    MODULE.write_text("\n".join(lignes), encoding="utf-8", newline="\n")
    print(f"ecrit {MODULE}")


if __name__ == "__main__":
    main()
