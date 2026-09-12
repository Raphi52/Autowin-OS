"""L'ATOME ANIME du demarrage, pour que l'ecran du LANCEUR porte le MEME spinner que l'application.

POURQUOI
--------
L'atome a trois orbites vit dans `src/renderer/index.html` (`.aw-atom`) : il ne peut donc apparaitre
qu'une fois Electron demarre. Pendant les 30 a 44 s de compilation, l'utilisateur ne voyait qu'un
logo FIXE. Demande du 2026-09-10 : « quand je start l'app je veux voir mon spinner ».

POURQUOI PILLOW ET PAS LE CANVAS TKINTER (defaut corrige le 2026-09-10)
-----------------------------------------------------------------------
Premiere version dessinee en `Canvas.create_line` : « le spinner est tout pixelise c'est pas le meme
qu'ailleurs ». Exact — le canvas tkinter n'a AUCUN lissage, ni alpha, ni degrade. Les escaliers
etaient donc structurels, pas reglables. Le rendu se fait maintenant en image : dessin a 4x puis
reduction LANCZOS (le lissage que le canvas n'a pas), vrai canal alpha pour la trainee qui s'eteint,
halo de la tete, et l'etoile centrale a 8 branches — le `clip-path` du CSS, sommet par sommet.

Pillow absent : on rend `None` et l'appelant retombe sur le logo fixe. Un lanceur ne meurt pas pour
une animation.
"""

from __future__ import annotations

import math
import re
import tkinter as tk
from pathlib import Path

try:  # Pillow fait le lissage ; sans lui, pas de spinner (et pas de plantage non plus).
    from PIL import Image, ImageDraw, ImageTk

    PILLOW = True
except Exception:  # noqa: BLE001 - environnement sans Pillow
    PILLOW = False

# Geometrie des trois plans, telle que la porte le CSS de `.aw-atom__plane--N` :
# scaleY(0.6) et rotate(0 / 55 / -55 deg). Les durees (2.7 / 3.3 / 3.9 s) et le sens inverse du
# plan 2 viennent de `.aw-atom__rot--N`.
APLAT = 0.6
PLANS: tuple[tuple[float, float, int], ...] = (
    (0.0, 2.7, 1),
    (55.0, 3.3, -1),
    (-55.0, 3.9, 1),
)
# Longueur de la trainee : le degrade conique du CSS est transparent jusqu'a 16 % et vif a 99 %,
# soit ~84 % du tour. On dessine donc 300 degres derriere la tete.
TRAINEE_DEG = 300.0
# Le supersampling : 4x suffit a effacer les escaliers a 40 px, sans faire ramer un demarrage.
SUR = 4
# Sommets de `.aw-atom__star` (clip-path polygon du CSS), en fractions de la boite.
ETOILE = (
    (0.50, 0.00), (0.58, 0.42), (1.00, 0.50), (0.58, 0.58),
    (0.50, 1.00), (0.42, 0.58), (0.00, 0.50), (0.42, 0.42),
)


def _teintes_orbites(index_html: Path) -> tuple[tuple[int, int, int], ...]:
    """Les trois teintes VIVES des trainees, lues dans `.aw-atom__trail--N` d'`index.html`.

    On prend la DERNIERE couleur pleine de chaque degrade conique (celle a 99 %, la tete de comete).
    Absence = on le DIT, on ne repeint pas avec une valeur inventee.
    """
    texte = index_html.read_text(encoding="utf-8")
    teintes: list[tuple[int, int, int]] = []
    for numero in (1, 2, 3):
        bloc = re.search(r"\.aw-atom__trail--%d\s*\{(.*?)\}" % numero, texte, re.DOTALL)
        if bloc is None:
            raise SystemExit(
                f"src/renderer/index.html ne porte plus .aw-atom__trail--{numero} : "
                "le spinner du lanceur n'a plus de source de couleur."
            )
        pleins = re.findall(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*1\s*\)", bloc.group(1))
        if not pleins:
            raise SystemExit(
                f"src/renderer/index.html : .aw-atom__trail--{numero} n'a plus de couleur pleine."
            )
        teintes.append(tuple(int(x) for x in pleins[-1]))  # type: ignore[arg-type]
    return tuple(teintes)


def points_orbite(
    centre: tuple[float, float],
    rayon: float,
    rotation_deg: float,
    tete_deg: float,
    segments: int,
) -> list[tuple[float, float]]:
    """Les points de la trainee, du plus ANCIEN au plus recent (la tete est le dernier).

    Ellipse aplatie de `APLAT` en Y puis tournee de `rotation_deg` — l'equivalent exact de
    `rotate(a) scaleY(0.6)` du CSS. Fonction PURE : c'est elle que testent les gardes du lanceur.
    """
    cx, cy = centre
    cos_r = math.cos(math.radians(rotation_deg))
    sin_r = math.sin(math.radians(rotation_deg))
    points: list[tuple[float, float]] = []
    for indice in range(segments + 1):
        avance = indice / segments  # 0 = queue, 1 = tete
        angle = math.radians(tete_deg - TRAINEE_DEG * (1.0 - avance))
        x = rayon * math.cos(angle)
        y = rayon * APLAT * math.sin(angle)
        points.append((cx + x * cos_r - y * sin_r, cy + x * sin_r + y * cos_r))
    return points


class SpinnerAtome:
    """L'atome, rendu en image. `avancer()` doit etre appele par la boucle de la fenetre.

    Aucun thread, aucun `after` interne : le battement du splash pilote deja tout le tkinter sur son
    propre thread, et deux planificateurs sur un meme widget est la recette d'un `TclError` a la
    fermeture.
    """

    SEGMENTS = 64  # assez fin pour que la trainee soit une courbe, pas une suite de cordes

    def __init__(self, parent: tk.Misc, taille: int, fond: str, racine_projet: Path) -> None:
        self.taille = taille
        self.fond = tuple(int(fond[i : i + 2], 16) for i in (1, 3, 5))
        self.teintes = _teintes_orbites(racine_projet / "src" / "renderer" / "index.html")
        self.widget = tk.Label(parent, bg=fond, bd=0, highlightthickness=0)
        self._image = None  # la reference doit vivre, sinon tkinter affiche du vide
        self._cote = taille * SUR
        self._rayon = self._cote * 0.419  # 0.8375em / 2 : le diametre des plans dans le CSS

    def _dessiner(self, secondes: float) -> "Image.Image":
        cote = self._cote
        image = Image.new("RGB", (cote, cote), self.fond)
        centre = (cote / 2, cote / 2)
        largeur = max(2, round(cote / 26))
        for (rotation, duree, sens), teinte in zip(PLANS, self.teintes):
            tete = sens * (secondes / duree) * 360.0 + rotation
            points = points_orbite(centre, self._rayon, rotation, tete, self.SEGMENTS)
            couche = Image.new("RGBA", (cote, cote), (0, 0, 0, 0))
            trace = ImageDraw.Draw(couche)
            for indice in range(len(points) - 1):
                # L'opacite suit le degrade conique du CSS : eteinte en queue, pleine a la tete.
                part = ((indice + 1) / (len(points) - 1)) ** 1.8
                trace.line(
                    [points[indice], points[indice + 1]],
                    fill=(*teinte, round(255 * part)),
                    width=largeur,
                    joint="curve",
                )
            image = Image.alpha_composite(image.convert("RGBA"), couche).convert("RGB")
            # La tete : un point blanc et son halo (`box-shadow` du CSS, en couches decroissantes).
            bx, by = points[-1]
            halo = Image.new("RGBA", (cote, cote), (0, 0, 0, 0))
            trace = ImageDraw.Draw(halo)
            for rayon, alpha in ((cote * 0.055, 70), (cote * 0.035, 130)):
                trace.ellipse([bx - rayon, by - rayon, bx + rayon, by + rayon], fill=(*teinte, alpha))
            r = cote * 0.021
            trace.ellipse([bx - r, by - r, bx + r, by + r], fill=(255, 255, 255, 255))
            image = Image.alpha_composite(image.convert("RGBA"), halo).convert("RGB")

        # Le coeur : les trois etoiles du CSS (`--edge` rose, `--core` orange, `--hot` doree), qui
        # respirent au rythme de `aw-atom-tw` (1.6 s).
        pulse = 0.92 + 0.08 * math.sin(secondes / 1.6 * 2 * math.pi)
        trace = ImageDraw.Draw(image)
        for fraction, couleur in ((0.2875, (255, 45, 149)), (0.244, (255, 138, 31)), (0.125, (255, 214, 107))):
            cote_etoile = cote * fraction * pulse
            gauche = centre[0] - cote_etoile / 2
            haut = centre[1] - cote_etoile / 2
            trace.polygon(
                [(gauche + x * cote_etoile, haut + y * cote_etoile) for x, y in ETOILE],
                fill=couleur,
            )
        # LA reduction : c'est elle qui donne le lissage que le canvas tkinter n'avait pas.
        return image.resize((self.taille, self.taille), Image.LANCZOS)

    def avancer(self, secondes: float) -> None:
        """Redessine l'atome a l'instant `secondes`. Tolere un widget deja detruit."""
        if not PILLOW:
            return
        try:
            self._image = ImageTk.PhotoImage(self._dessiner(secondes))
            self.widget.config(image=self._image)
        except tk.TclError:
            pass  # Fenetre en cours de fermeture : un spinner ne fait pas echouer un demarrage.


def disponible() -> bool:
    """Vrai si l'animation peut etre rendue (Pillow present). Sinon l'appelant garde le logo fixe."""
    return PILLOW
