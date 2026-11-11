"""Assemble les images de la panda en kimono en planches pour la mascotte du bureau.

La panda est modelee et animee dans Blender (fourrure, squelette, kimono, visage a expressions,
huit gestes de 16 images). Blender rend une image par numero (`f-001.png` ... `f-128.png`, fond
transparent, 384x384 : le double de la planche, reduit ici pour un poil et des motifs plus nets) ;
ce script les colle par geste en planches de 16 images de 192x192 cote a cote, en WebP, et ecrit
le module TypeScript que la page de la mascotte embarque. La fenetre de la mascotte n'admet aucun
script : la 3D y est rejouee en CSS, par `steps(16)`.

Rendu : UN seul Blender a la fois, deux au plus. Sur une carte graphique de 2 Go, quatre rendus
en parallele se disputent la memoire : mesure, plus de 100 s par image chacun contre 9 s seul.

Usage : python scripts/mascotte-panda-planches.py <dossier des f-NNN.png> [--apercu <dossier>]
"""

import base64
import io
import sys
from pathlib import Path

from PIL import Image

# L'ordre des gestes est celui de la ligne de temps du fichier Blender : 16 images chacun.
GESTES = ["REPOS", "SALUT", "LUEUR", "GRIGNOTE", "MARCHE", "DANSE", "APPLAUDIT", "SOUCI"]
IMAGES_PAR_GESTE = 16
LARGEUR, HAUTEUR = 192, 192
RACINE = Path(__file__).resolve().parent.parent
MODULE = RACINE / "src" / "main" / "mascotte" / "mascotte-panda-images.ts"

ENTETE = """/**
 * Les planches de la PANDA en kimono : modelee et animee dans Blender (fourrure, squelette), rendue
 * en 16 images par geste (192x192, WebP), cote a cote. La fenetre de la mascotte n'admet aucun
 * script : la 3D y est donc rejouee en CSS, par `steps(16)`. Genere par
 * `scripts/mascotte-panda-planches.py` — ne pas editer a la main.
 */
"""


# Le rendu de Blender sort peu contraste (noir de la fourrure vers 49-90, blanc vers 207-223 sur
# 255, mesures sur l'image de repos) : pose sur un bureau, la panda paraissait delavee. On etire
# donc les tons entre ces deux bornes, sans toucher a la transparence. Le noir se cale juste sous le
# poil le plus sombre : plus bas, son pelage noir, fin et clair aux pointes, tournait au gris.
NOIR, BLANC = 45, 220
TABLE = [max(0, min(255, round((v - NOIR) * 255 / (BLANC - NOIR)))) for v in range(256)]


def contraste(image: Image.Image) -> Image.Image:
    r, v, b, a = image.split()
    return Image.merge("RGBA", (r.point(TABLE), v.point(TABLE), b.point(TABLE), a))


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
        feuille.paste(contraste(image), (i * LARGEUR, 0))
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
