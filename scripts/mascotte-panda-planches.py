"""Assemble les images du panda en peluche en planches pour la mascotte du bureau.

Le panda est modele et anime dans Blender (fourrure, squelette, huit gestes de 16 images). Blender
rend une image par numero (`f-001.png` ... `f-128.png`, 160x192, fond transparent) ; ce script les
colle par geste en planches de 16 images cote a cote, en WebP, et ecrit le module TypeScript que
la page de la mascotte embarque. La fenetre de la mascotte n'admet aucun script : la 3D y est
rejouee en CSS, par `steps(16)`.

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
LARGEUR, HAUTEUR = 160, 192
RACINE = Path(__file__).resolve().parent.parent
MODULE = RACINE / "src" / "main" / "mascotte" / "mascotte-panda-images.ts"

ENTETE = """/**
 * Les planches du PANDA en peluche : modele et anime dans Blender (fourrure, squelette), rendu
 * en 16 images par geste (160x192, WebP), cote a cote. La fenetre de la mascotte n'admet aucun
 * script : la 3D y est donc rejouee en CSS, par `steps(16)`. Genere par
 * `scripts/mascotte-panda-planches.py` — ne pas editer a la main.
 */
"""


# Le rendu de Blender sort peu contraste (noir de la fourrure vers 54-70, blanc vers 205-215 sur
# 255, mesures sur l'image de repos) : pose sur un bureau, le panda paraissait delave. On etire
# donc les tons entre ces deux bornes, sans toucher a la transparence.
NOIR, BLANC = 46, 218
TABLE = [max(0, min(255, round((v - NOIR) * 255 / (BLANC - NOIR)))) for v in range(256)]


def contraste(image: Image.Image) -> Image.Image:
    r, v, b, a = image.split()
    return Image.merge("RGBA", (r.point(TABLE), v.point(TABLE), b.point(TABLE), a))


def planche(dossier: Path, rang: int) -> Image.Image:
    feuille = Image.new("RGBA", (LARGEUR * IMAGES_PAR_GESTE, HAUTEUR), (0, 0, 0, 0))
    for i in range(IMAGES_PAR_GESTE):
        numero = rang * IMAGES_PAR_GESTE + i + 1
        image = Image.open(dossier / f"f-{numero:03d}.png").convert("RGBA")
        if image.size != (LARGEUR, HAUTEUR):
            raise SystemExit(f"f-{numero:03d}.png : {image.size}, attendu {(LARGEUR, HAUTEUR)}")
        feuille.paste(contraste(image), (i * LARGEUR, 0))
    return feuille


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dossier = Path(sys.argv[1])
    apercu = Path(sys.argv[sys.argv.index("--apercu") + 1]) if "--apercu" in sys.argv else None
    lignes = [ENTETE]
    for rang, geste in enumerate(GESTES):
        feuille = planche(dossier, rang)
        tampon = io.BytesIO()
        feuille.save(tampon, "WEBP", quality=82, method=6)
        if apercu:
            apercu.mkdir(parents=True, exist_ok=True)
            feuille.save(apercu / f"planche-{geste.lower()}.png")
        donnees = base64.b64encode(tampon.getvalue()).decode("ascii")
        lignes.append(f"export const PANDA_{geste} =\n  'data:image/webp;base64,{donnees}'\n")
        print(f"{geste}: {len(tampon.getvalue())} octets")
    MODULE.write_text("\n".join(lignes), encoding="utf-8", newline="\n")
    print(f"ecrit {MODULE}")


if __name__ == "__main__":
    main()
