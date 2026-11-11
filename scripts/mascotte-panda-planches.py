"""Assemble les images de la panda en kimono en planches pour la mascotte du bureau.

La panda est modelee et animee dans Blender (fourrure, squelette, kimono, visage a expressions,
huit gestes de 16 images). Blender rend une image par numero (`f-001.png` ... `f-128.png`,
192x192, fond transparent) ; ce script les colle par geste en planches de 16 images cote a cote,
en WebP, et ecrit le module TypeScript que la page de la mascotte embarque. La fenetre de la
mascotte n'admet aucun script : la 3D y est rejouee en CSS, par `steps(16)`.

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


# Le rendu de Blender sort peu contraste (noir de la fourrure vers 54-70, blanc vers 205-215 sur
# 255, mesures sur l'image de repos) : pose sur un bureau, la panda paraissait delavee. On etire
# donc les tons entre ces deux bornes, sans toucher a la transparence.
NOIR, BLANC = 46, 218
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


def planche(dossier: Path, rang: int, au_bord: dict[int, int]) -> Image.Image:
    feuille = Image.new("RGBA", (LARGEUR * IMAGES_PAR_GESTE, HAUTEUR), (0, 0, 0, 0))
    for i in range(IMAGES_PAR_GESTE):
        numero = rang * IMAGES_PAR_GESTE + i + 1
        image = Image.open(dossier / f"f-{numero:03d}.png").convert("RGBA")
        if image.size != (LARGEUR, HAUTEUR):
            raise SystemExit(f"f-{numero:03d}.png : {image.size}, attendu {(LARGEUR, HAUTEUR)}")
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
