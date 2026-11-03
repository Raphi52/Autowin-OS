"""Tests de scripts/aplomb_image.py (conv-1444) : des rayures dessinées à un angle connu."""
import math
import os
import sys
import unittest

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from aplomb_image import mesurer  # noqa: E402


def rayures(angle_deg, pente_droite=None):
    """Rayures sombres sur fond clair, lissées comme une peinture (tracées 4 fois plus grand puis réduites) ;
    `pente_droite` donne un autre angle au tiers droit (perspective)."""
    k = 4
    im = Image.new('L', (600 * k, 400 * k), 220)
    d = ImageDraw.Draw(im)
    for y in range(-200, 600, 24):
        for x0, x1, a in ((0, 400, angle_deg), (400, 600, angle_deg if pente_droite is None else pente_droite)):
            t = math.tan(math.radians(a))
            ya = y + x0 * math.tan(math.radians(angle_deg))
            d.line([(x0 * k, ya * k), (x1 * k, (ya + (x1 - x0) * t) * k)], fill=40, width=4 * k)
    return im.resize((600, 400), Image.LANCZOS)


class AplombImage(unittest.TestCase):
    def test_rayures_horizontales_a_plat(self):
        r = mesurer(rayures(0))
        self.assertLess(abs(r['angle_median']), 0.5)
        self.assertGreater(r['part_a_plat'], 0.9)

    def test_rayures_qui_descendent_vers_la_droite(self):
        r = mesurer(rayures(8))
        self.assertAlmostEqual(r['angle_median'], 8, delta=1)
        self.assertLess(r['part_a_plat'], 0.1)

    def test_perspective_trahie_par_l_ecart_gauche_droite(self):
        r = mesurer(rayures(0, pente_droite=-10))
        self.assertLess(abs(r['gauche']), 1)
        self.assertAlmostEqual(r['droite'], -10, delta=1.5)

    def test_masque_restreint_la_mesure(self):
        im = rayures(8)
        import numpy as np
        m = np.zeros((400, 600), bool)
        r = mesurer(im, masque=m)
        self.assertIsNone(r['angle_median'])


if __name__ == '__main__':
    unittest.main()
