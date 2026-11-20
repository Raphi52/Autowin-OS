"""VIDÉO EXPLICATIVE EN MOTION DESIGN à partir de captures d'écran : zooms animés, surlignage, légendes, chapitres → MP4.

Pourquoi : montrer un parcours (une démo, un processus) à quelqu'un qui ne l'a pas sous les yeux — un client, un
collègue — sans filmer l'écran ni monter à la main. Le scénario (JSON) dit quoi montrer ; le script fait la caméra,
le texte et l'encodage. Écrit le 20/11/2026 pour la vidéo client de la saisie d'audience web (conv-2020).

Usage, depuis le dépôt Autowin :
  python scripts/video_explicative.py <scenario.json> [--sortie video.mp4] [--images-cles <dossier>]
                                      [--images-cles-seules] [--ffmpeg <exe>]
  --images-cles écrit une image par temps fort (fin de chaque zoom) : on les RELIT avant d'envoyer la vidéo.
  --images-cles-seules ne fait que ces images (quelques secondes) : pour régler le scénario avant l'encodage.
ffmpeg : --ffmpeg, sinon la variable FFMPEG, sinon le PATH, sinon le paquet imageio-ffmpeg s'il est importable.

Scénario : {"taille":[1920,1080], "fps":30, "base":"<dossier des captures>", "entete":"<texte en haut à droite>",
 "couleurs":{"fond":"#1b1e25","fond2":"#262b35","accent":"#d6a84e","texte":"#f3f1ec","discret":"#a9adb8"},
 "plans":[ … ]}
Plans (champ « type ») ; chacun peut porter « rubrique » (surtitre en haut à gauche, gardé d'un plan au suivant) :
 - titre       : titre, sous_titre, mention, duree
 - chapitre    : numero, titre, sous_titre, duree
 - capture     : image, flous:[[x0,y0,x1,y1]…], depart:[x0,y0,x1,y1] (absent = image entière),
                 temps:[{cadre:[x0,y0,x1,y1] ou null, surligne:bool, texte, sous_texte, duree}]
 - extraits    : image, flous, bandes:[[x0,y0,x1,y1]…] (morceaux empilés), surligne:[indices], texte, sous_texte, duree
 - cote_a_cote : images:[…], flous:{"<image>":[rects]}, texte, sous_texte, duree
 - liste       : titre, points:[…], numerote:bool, conclusion, duree
Les rectangles sont en pixels de la capture. « flous » floute une zone (nom d'une personne, donnée à ne pas montrer).

Voix off : chaque temps d'une capture, et chaque autre plan, peut porter « voix » (la phrase dite). Trois commandes :
  1. python scripts/video_explicative.py <scenario.json> --script-voix voix.md
  2. <autowin-video>/voix/env/Scripts/python.exe <autowin-video>/voix/outils/narration_v2.py voix.md <dossier> <ffmpeg>
     (l'outil de voix existant : voix française fr-FR-DeniseNeural, par edge-tts ; il écrit NN.pcm par moment)
  3. python scripts/video_explicative.py <scenario.json> --voix <dossier> --ffmpeg <ffmpeg>
Au rendu, un moment dure au moins le temps de sa voix (AVANT_VOIX + voix + APRES_VOIX) ; la vidéo s'allonge d'autant.
<autowin-video> = C:/Users/<vous>/AppData/Local/autowin-video ; son ffmpeg est dans film/bin/ffmpeg.exe.
Codes de sortie : 0 vidéo (ou images clés) écrite, 1 ffmpeg en échec, 2 scénario ou commande refusés.
"""

from __future__ import annotations

import argparse
import array
import json
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

POLICES = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
COULEURS_DEFAUT = {"fond": "#1b1e25", "fond2": "#262b35", "accent": "#d6a84e", "texte": "#f3f1ec", "discret": "#a9adb8"}
FONDU = 0.35  # secondes d'entrée et de sortie de chaque plan
# Voix off : la voix part une fois la légende entrée, et laisse un souffle avant le moment suivant.
AVANT_VOIX = 0.4
APRES_VOIX = 0.35
# Format des voix de l'outil existant (autowin-video/voix/outils/narration_v2.py, constante TAUX) : PCM 16 bits mono.
TAUX_VOIX = 24000


# ---------------------------------------------------------------- fonctions pures (testées) ----------------------


def adoucir(t: float) -> float:
    """Courbe d'accélération puis de freinage (cubique), de 0 à 1."""
    t = max(0.0, min(1.0, t))
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def cadrer(cadre, aspect: float, source: tuple[int, int], marge: float = 0.06) -> tuple[float, float, float, float]:
    """Rectangle de caméra au rapport `aspect` (largeur/hauteur) qui contient `cadre` avec une marge, rentré dans la
    capture quand il y tient, centré sur elle sinon (le reste du panneau est alors du fond)."""
    sw, sh = source
    x0, y0, x1, y1 = cadre if cadre else (0, 0, sw, sh)
    w, h = (x1 - x0) * (1 + 2 * marge), (y1 - y0) * (1 + 2 * marge)
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    def ranger(c: float, taille: float, borne: int) -> float:
        if taille >= borne:
            return borne / 2
        return min(max(c, taille / 2), borne - taille / 2)
    cx, cy = ranger(cx, w, sw), ranger(cy, h, sh)
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def interpoler(a, b, t: float):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def resserrer(r, f: float):
    """Le rectangle `r` resserré d'un facteur f autour de son centre (f < 1 = la caméra avance)."""
    cx, cy, w, h = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) * f, (r[3] - r[1]) * f
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def couper_lignes(texte: str, mesure, largeur: float) -> list[str]:
    """Coupe `texte` en lignes dont la largeur mesurée (mesure(chaîne) -> px) ne dépasse pas `largeur`."""
    lignes: list[str] = []
    for paragraphe in texte.split("\n"):
        ligne = ""
        for mot in paragraphe.split():
            essai = f"{ligne} {mot}".strip()
            if ligne and mesure(essai) > largeur:
                lignes.append(ligne)
                ligne = mot
            else:
                ligne = essai
        lignes.append(ligne)
    return lignes


def duree_plan(plan: dict) -> float:
    if plan["type"] == "capture":
        return sum(float(t["duree"]) for t in plan["temps"])
    return float(plan["duree"])


def chronologie(plans: list[dict]) -> list[tuple[dict, float, float]]:
    """(plan, début, durée) pour chaque plan, bout à bout."""
    debut, sortie = 0.0, []
    for p in plans:
        d = duree_plan(p)
        sortie.append((p, debut, d))
        debut += d
    return sortie


def segments(plans: list[dict]) -> list[dict]:
    """Les moments de la vidéo, dans l'ordre : chaque temps d'une capture, chaque autre plan. Chacun porte sa
    « duree » et peut porter sa « voix ». Le moment n (à partir de 1) est le fichier NN.pcm de l'outil de voix."""
    return [m for p in plans for m in (p["temps"] if p["type"] == "capture" else [p])]


def script_voix(plans: list[dict]) -> str:
    """Le texte de la voix off au format de l'outil de voix (`## n. …` puis `### Voix`), un moment par chapitre."""
    blocs = [f"## {n}. moment {n}\n\n### Voix\n\n{m['voix'].strip()}\n"
             for n, m in enumerate(segments(plans), 1) if m.get("voix")]
    return "# Voix off\n\n" + "\n".join(blocs)


def caler_sur_voix(plans: list[dict], durees: dict[int, float], avant: float = AVANT_VOIX,
                   apres: float = APRES_VOIX) -> list[dict]:
    """Copie des plans où chaque moment dure au moins le temps de sa voix (durees : numéro -> secondes) : la voix
    part `avant` s après le début du moment et finit `apres` s avant la fin. Un moment plus long que sa voix garde
    sa durée. Le scénario d'origine n'est pas modifié."""
    copie = json.loads(json.dumps(plans))
    for n, m in enumerate(segments(copie), 1):
        if n in durees:
            m["duree"] = max(float(m["duree"]), avant + durees[n] + apres)
    return copie


def piste_voix(plans: list[dict], voix: dict[int, bytes], taux: int, avant: float = AVANT_VOIX) -> bytes:
    """Piste son (PCM 16 bits mono à `taux` Hz) de toute la vidéo : la voix du moment n posée `avant` s après son
    début, du silence ailleurs. Les plans doivent déjà être calés (caler_sur_voix) : une voix trop longue est coupée."""
    total = round(sum(duree_plan(p) for p in plans) * taux)
    piste = bytearray(2 * total)
    debut = 0.0
    for n, m in enumerate(segments(plans), 1):
        fin = debut + float(m["duree"])
        if n in voix:
            o = 2 * round((debut + avant) * taux)
            morceau = voix[n][:max(0, min(len(piste), 2 * round(fin * taux)) - o)]
            piste[o:o + len(morceau)] = morceau
        debut = fin
    return bytes(piste)


def duree_parlee(pcm: bytes, taux: int, seuil: int = 300) -> float:
    """Secondes jusqu'au dernier son audible d'une voix (PCM 16 bits mono). L'outil de voix laisse environ 1,3 s de
    silence à la fin de chaque morceau : caler les moments sur la fin du fichier allongeait la vidéo d'autant."""
    echantillons = array.array("h", pcm[:len(pcm) // 2 * 2])
    for i in range(len(echantillons) - 1, -1, -1):
        if abs(echantillons[i]) > seuil:
            return (i + 1) / taux
    return 0.0


def lire_voix(dossier: Path) -> dict[int, bytes]:
    """Les voix rendues par l'outil de voix : NN.pcm (PCM 16 bits mono, TAUX_VOIX Hz) -> {n: octets}."""
    return {int(f.stem): f.read_bytes() for f in sorted(Path(dossier).glob("*.pcm")) if f.stem.isdigit()}


def couleur(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- rendu ------------------------------------------


class Rendu:
    def __init__(self, scenario: dict, base: Path):
        self.sc = scenario
        self.base = base
        self.W, self.H = scenario.get("taille", [1920, 1080])
        self.k = self.W / 1920
        self.fps = int(scenario.get("fps", 30))
        self.c = {n: couleur(v) for n, v in {**COULEURS_DEFAUT, **scenario.get("couleurs", {})}.items()}
        self.plans = chronologie(scenario["plans"])
        self.total = sum(d for _, _, d in self.plans)
        k = self.k
        self.panneau = (int(80 * k), int(96 * k), self.W - int(80 * k), int(842 * k))
        px0, py0, px1, py1 = self.panneau
        self.pw, self.ph = px1 - px0, py1 - py0
        self.aspect = self.pw / self.ph
        self._polices: dict = {}
        self._images: dict = {}
        self._textes: dict = {}
        self._masques: dict = {}
        self.fond = self._degrade()
        # rubrique courante de chaque plan (gardée d'un plan au suivant)
        r = ""
        self.rubriques = []
        for p, _, _ in self.plans:
            r = p.get("rubrique", r)
            self.rubriques.append(r)

    # -- ressources
    def police(self, nom: str, taille: float):
        cle = (nom, int(taille))
        if cle not in self._polices:
            fichiers = {"gras": ["segoeuib.ttf", "arialbd.ttf"], "demi": ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"],
                        "texte": ["segoeui.ttf", "arial.ttf"], "titrage": ["bahnschrift.ttf", "segoeuib.ttf", "arialbd.ttf"]}[nom]
            for f in fichiers:
                if (POLICES / f).exists():
                    self._polices[cle] = ImageFont.truetype(str(POLICES / f), int(taille))
                    break
            else:
                self._polices[cle] = ImageFont.load_default()
        return self._polices[cle]

    def image(self, nom: str, flous=()) -> Image.Image:
        cle = (nom, tuple(map(tuple, flous)))
        if cle not in self._images:
            im = Image.open(self.base / nom).convert("RGB")
            for r in flous:
                box = tuple(int(v) for v in r)
                zone = im.crop(box).filter(ImageFilter.GaussianBlur(max(6, (box[3] - box[1]) // 2)))
                im.paste(zone, box)
            self._images[cle] = im
        return self._images[cle]

    def masque_arrondi(self, w: int, h: int, rayon: int) -> Image.Image:
        cle = (w, h, rayon)
        if cle not in self._masques:
            m = Image.new("L", (w, h), 0)
            ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), rayon, fill=255)
            self._masques[cle] = m
        return self._masques[cle]

    def _degrade(self) -> Image.Image:
        haut, bas = self.c["fond"], self.c["fond2"]
        bande = Image.new("RGB", (1, self.H))
        for y in range(self.H):
            t = y / max(1, self.H - 1)
            bande.putpixel((0, y), tuple(int(a + (b - a) * t) for a, b in zip(haut, bas)))
        return bande.resize((self.W, self.H)).convert("RGBA")

    def bloc_texte(self, texte: str, police: str, taille: float, teinte: str, largeur: float, interligne=1.25,
                   espacement=0, centre=False) -> Image.Image:
        """Le texte rendu une fois sur fond transparent (mis en cache)."""
        cle = (texte, police, taille, teinte, largeur, interligne, espacement, centre)
        if cle in self._textes:
            return self._textes[cle]
        f = self.police(police, taille)
        mesure = (lambda s: f.getlength(s) + espacement * max(0, len(s) - 1))
        lignes = couper_lignes(texte, mesure, largeur) if texte else []
        hl = int(taille * interligne)
        w = int(max([mesure(l) for l in lignes] + [1])) + 4
        # Marge au-dessus : l'accent d'une capitale (À, É) monte plus haut que la ligne de tête de la police et
        # serait coupé au bord de l'image. `poser` retire cette marge, le texte reste à la place demandée.
        haut = int(taille * 0.3)
        im = Image.new("RGBA", (int(largeur) if centre else w, max(1, haut + hl * len(lignes) + int(taille * 0.35))), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for i, l in enumerate(lignes):
            x = (im.width - mesure(l)) / 2 if centre else 0
            if espacement:
                for ch in l:
                    d.text((x, haut + i * hl), ch, font=f, fill=self.c[teinte])
                    x += f.getlength(ch) + espacement
            else:
                d.text((x, haut + i * hl), l, font=f, fill=self.c[teinte])
        im.info["haut"] = haut
        self._textes[cle] = im
        return im

    def poser(self, toile: Image.Image, im: Image.Image, x: float, y: float, alpha: float = 1.0):
        if alpha <= 0:
            return
        haut = im.info.get("haut", 0)
        if alpha < 1:
            im = im.copy()
            im.putalpha(im.getchannel("A").point(lambda v: int(v * alpha)))
        x, y = int(x), int(y) - haut
        if x < 0 or y < 0:  # alpha_composite refuse une destination négative : on coupe ce qui dépasse
            im = im.crop((max(0, -x), max(0, -y), im.width, im.height))
            x, y = max(0, x), max(0, y)
        toile.alpha_composite(im, (x, y))

    # -- éléments communs
    def legende(self, toile, texte, sous_texte, u, duree, entree=FONDU):
        k = self.k
        a = adoucir(u / entree) if entree else 1
        if duree - u < 0.25:
            a *= max(0.0, (duree - u) / 0.25)
        dy = (1 - a) * 14 * k
        larg = self.W - 160 * k
        y = 872 * k + dy
        if texte:
            b = self.bloc_texte(texte, "demi", 40 * k, "texte", larg)
            self.poser(toile, b, 80 * k, y, a)
            y += b.height + 2 * k
        if sous_texte:
            self.poser(toile, self.bloc_texte(sous_texte, "texte", 29 * k, "discret", larg), 80 * k, y, a)

    def entete(self, toile, i):
        k = self.k
        rub = self.rubriques[i]
        if rub:
            self.poser(toile, self.bloc_texte(rub.upper(), "titrage", 25 * k, "accent", 1200 * k, espacement=3 * k), 80 * k, 38 * k)
        if self.sc.get("entete"):
            b = self.bloc_texte(self.sc["entete"], "texte", 22 * k, "discret", 900 * k)
            self.poser(toile, b, self.W - 80 * k - b.width, 40 * k)

    def progression(self, toile, t):
        k = self.k
        d = ImageDraw.Draw(toile)
        y0, y1 = self.H - int(5 * k), self.H
        d.rectangle((0, y0, self.W, y1), fill=self.c["fond2"] + (255,))
        d.rectangle((0, y0, int(self.W * min(1, t / self.total)), y1), fill=self.c["accent"] + (255,))

    def contour(self, toile, rect, alpha, epaisseur=4, ombre=True):
        """Surligne `rect` (coordonnées écran) : contour doré, le reste du panneau un peu assombri."""
        if alpha <= 0:
            return
        k = self.k
        px0, py0, px1, py1 = self.panneau
        calque = Image.new("RGBA", (self.pw, self.ph), (0, 0, 0, 0))
        d = ImageDraw.Draw(calque)
        r = (rect[0] - px0, rect[1] - py0, rect[2] - px0, rect[3] - py0)
        if ombre:
            d.rectangle((0, 0, self.pw, self.ph), fill=(0, 0, 0, int(105 * alpha)))
            d.rounded_rectangle(r, int(10 * k), fill=(0, 0, 0, 0))
        d.rounded_rectangle(r, int(10 * k), outline=self.c["accent"] + (int(255 * alpha),), width=max(2, int(epaisseur * k)))
        toile.alpha_composite(calque, (px0, py0))

    # -- plans
    def plan_capture(self, toile, p, u):
        im = self.image(p["image"], p.get("flous", []))
        src = im.size
        px0, py0, px1, py1 = self.panneau
        precedent = cadrer(p.get("depart"), self.aspect, src, 0.0 if not p.get("depart") else 0.06)
        debut = 0.0
        for n, tp in enumerate(p["temps"]):
            d = float(tp["duree"])
            cible = cadrer(tp.get("cadre"), self.aspect, src, 0.0 if not tp.get("cadre") else 0.08)
            if u < debut + d or n == len(p["temps"]) - 1:
                ub = u - debut
                m = min(1.1, 0.4 * d) if cible != precedent else 0.0
                if ub < m:
                    rect = interpoler(precedent, cible, adoucir(ub / m))
                else:
                    rect = resserrer(cible, 1 - 0.035 * adoucir((ub - m) / max(0.01, d - m)))
                vue = im.transform((self.pw, self.ph), Image.EXTENT, rect, Image.BILINEAR, fillcolor=self.c["fond2"])
                toile.paste(vue, (px0, py0), self.masque_arrondi(self.pw, self.ph, int(14 * self.k)))
                if tp.get("surligne") and tp.get("cadre"):
                    ech = self.pw / (rect[2] - rect[0])
                    c = tp["cadre"]
                    pad = 6 * self.k
                    ecran = (px0 + (c[0] - rect[0]) * ech - pad, py0 + (c[1] - rect[1]) * ech - pad,
                             px0 + (c[2] - rect[0]) * ech + pad, py0 + (c[3] - rect[1]) * ech + pad)
                    self.contour(toile, ecran, adoucir((ub - m) / 0.4))
                self.legende(toile, tp.get("texte"), tp.get("sous_texte"), ub, d if n < len(p["temps"]) - 1 else d + 1)
                return
            precedent = resserrer(cible, 1 - 0.035)
            debut += d

    def plan_extraits(self, toile, p, u, d):
        k = self.k
        im = self.image(p["image"], p.get("flous", []))
        bandes = [im.crop(tuple(int(v) for v in b)) for b in p["bandes"]]
        ecart = 16 * k
        largeur_max = max(b.width for b in bandes)
        hauteur = sum(b.height for b in bandes)
        ech = min(self.pw * 0.96 / largeur_max, (self.ph * 0.94 - ecart * (len(bandes) - 1)) / hauteur, 2.2)
        px0, py0, _, _ = self.panneau
        y = py0 + (self.ph - (hauteur * ech + ecart * (len(bandes) - 1))) / 2
        for i, b in enumerate(bandes):
            cle = ("bande", p["image"], tuple(p["bandes"][i]), ech)
            if cle not in self._textes:
                r = b.resize((int(b.width * ech), int(b.height * ech)), Image.LANCZOS).convert("RGBA")
                r.putalpha(self.masque_arrondi(r.width, r.height, int(8 * k)))
                self._textes[cle] = r
            r = self._textes[cle]
            a = adoucir((u - 0.25 - 0.3 * i) / 0.45)
            x = px0 + (self.pw - r.width) / 2 + (1 - a) * 70 * k
            self.poser(toile, r, x, y, a)
            if i in p.get("surligne", []):
                s = adoucir((u - 0.6 - 0.3 * len(bandes)) / 0.4)
                ImageDraw.Draw(toile).rounded_rectangle((x - 5 * k, y - 5 * k, x + r.width + 5 * k, y + r.height + 5 * k), int(10 * k),
                                                       outline=self.c["accent"] + (int(255 * s),), width=max(2, int(4 * k)))
            y += r.height + ecart
        self.legende(toile, p.get("texte"), p.get("sous_texte"), u, d)

    def plan_cote_a_cote(self, toile, p, u, d):
        k = self.k
        flous = p.get("flous", {})
        ims = [self.image(n, flous.get(n, [])) for n in p["images"]]
        ecart = 48 * k
        h = min(self.ph * 0.97, (self.pw - ecart * (len(ims) - 1)) / sum(i.width / i.height for i in ims))
        total = sum(i.width * h / i.height for i in ims) + ecart * (len(ims) - 1)
        px0, py0, _, _ = self.panneau
        x = px0 + (self.pw - total) / 2
        for n, im in enumerate(ims):
            w = im.width * h / im.height
            cle = ("cote", p["images"][n], int(h))
            if cle not in self._textes:
                r = im.resize((int(w), int(h)), Image.LANCZOS).convert("RGBA")
                r.putalpha(self.masque_arrondi(r.width, r.height, int(12 * k)))
                self._textes[cle] = r
            a = adoucir((u - 0.2 - 0.35 * n) / 0.5)
            self.poser(toile, self._textes[cle], x, py0 + (self.ph - h) / 2 + (1 - a) * 50 * k, a)
            x += w + ecart
        self.legende(toile, p.get("texte"), p.get("sous_texte"), u, d)

    def plan_titre(self, toile, p, u, d):
        k = self.k
        if p.get("mention"):
            b = self.bloc_texte(p["mention"].upper(), "titrage", 28 * k, "accent", 1600 * k, espacement=4 * k, centre=True)
            self.poser(toile, b, (self.W - b.width) / 2, 330 * k, adoucir(u / 0.6))
        b = self.bloc_texte(p["titre"], "gras", 92 * k, "texte", 1600 * k, centre=True)
        self.poser(toile, b, (self.W - b.width) / 2, 400 * k + (1 - adoucir(u / 0.8)) * 20 * k, adoucir(u / 0.8))
        y = 400 * k + b.height + 26 * k
        lg = 380 * k * adoucir((u - 0.3) / 0.9)
        ImageDraw.Draw(toile).rectangle(((self.W - lg) / 2, y, (self.W + lg) / 2, y + 4 * k), fill=self.c["accent"] + (255,))
        if p.get("sous_titre"):
            s = self.bloc_texte(p["sous_titre"], "texte", 40 * k, "discret", 1500 * k, centre=True)
            self.poser(toile, s, (self.W - s.width) / 2, y + 36 * k, adoucir((u - 0.6) / 0.6))

    def plan_chapitre(self, toile, p, u, d):
        k = self.k
        a = adoucir(u / 0.5)
        num = self.bloc_texte(str(p["numero"]), "titrage", 210 * k, "accent", 400 * k)
        x0 = 300 * k
        self.poser(toile, num, x0 - (1 - a) * 40 * k, (self.H - num.height) / 2 - 20 * k, a)
        xt = x0 + num.width + 60 * k
        t = self.bloc_texte(p["titre"], "gras", 76 * k, "texte", 1100 * k)
        yt = self.H / 2 - t.height + 10 * k
        self.poser(toile, t, xt + (1 - a) * 40 * k, yt, a)
        lg = 300 * k * adoucir((u - 0.2) / 0.8)
        ImageDraw.Draw(toile).rectangle((xt, yt + t.height + 8 * k, xt + lg, yt + t.height + 12 * k), fill=self.c["accent"] + (255,))
        if p.get("sous_titre"):
            s = self.bloc_texte(p["sous_titre"], "texte", 38 * k, "discret", 1100 * k)
            self.poser(toile, s, xt, yt + t.height + 32 * k, adoucir((u - 0.4) / 0.6))

    def plan_liste(self, toile, p, u, d):
        k = self.k
        t = self.bloc_texte(p["titre"], "gras", 64 * k, "texte", 1600 * k)
        self.poser(toile, t, 200 * k, 190 * k, adoucir(u / 0.5))
        ImageDraw.Draw(toile).rectangle((200 * k, 190 * k + t.height + 10 * k, 200 * k + 220 * k * adoucir(u / 0.8),
                                         190 * k + t.height + 14 * k), fill=self.c["accent"] + (255,))
        y = 190 * k + t.height + 70 * k
        for i, pt in enumerate(p["points"]):
            a = adoucir((u - 0.7 - 0.55 * i) / 0.45)
            puce = self.bloc_texte(f"{i + 1}." if p.get("numerote") else "—", "titrage", 44 * k, "accent", 100 * k)
            b = self.bloc_texte(pt, "texte", 44 * k, "texte", 1380 * k)
            self.poser(toile, puce, 200 * k + (1 - a) * 30 * k, y, a)
            self.poser(toile, b, 280 * k + (1 - a) * 30 * k, y, a)
            y += b.height + 30 * k
        if p.get("conclusion"):
            c = self.bloc_texte(p["conclusion"], "demi", 38 * k, "accent", 1500 * k)
            self.poser(toile, c, 200 * k, y + 30 * k, adoucir((u - 0.9 - 0.55 * len(p["points"])) / 0.5))

    def image_a(self, t: float) -> Image.Image:
        for i, (p, debut, d) in enumerate(self.plans):
            if t < debut + d or i == len(self.plans) - 1:
                break
        u = t - debut
        toile = self.fond.copy()
        if p["type"] == "capture":
            self.plan_capture(toile, p, u)
        else:
            getattr(self, "plan_" + p["type"])(toile, p, u, d)
        self.entete(toile, i)
        fondu = min(1.0, u / FONDU if i > 0 else 1.0, (d - u) / FONDU if i < len(self.plans) - 1 else 1.0)
        if fondu < 1:
            toile = Image.blend(self.fond, toile, max(0.0, fondu))
        self.progression(toile, t)
        return toile.convert("RGB")

    def temps_forts(self) -> list[tuple[str, float]]:
        """Un instant par zoom ou par plan, là où tout est arrivé à l'écran : ce qu'on relit avant d'envoyer."""
        sortie = []
        for i, (p, debut, d) in enumerate(self.plans):
            if p["type"] == "capture":
                t0 = debut
                for n, tp in enumerate(p["temps"]):
                    sortie.append((f"{i + 1:02d}-{p['type']}-{n + 1}", t0 + float(tp["duree"]) * 0.8))
                    t0 += float(tp["duree"])
            else:
                sortie.append((f"{i + 1:02d}-{p['type']}", debut + d * 0.85))
        return sortie


TYPES = {"titre": ["titre", "duree"], "chapitre": ["numero", "titre", "duree"], "capture": ["image", "temps"],
         "extraits": ["image", "bandes", "duree"], "cote_a_cote": ["images", "duree"], "liste": ["titre", "points", "duree"]}


def verifier_scenario(sc: dict, base: Path) -> list[str]:
    """Les défauts du scénario (type inconnu, champ manquant, image absente, rectangle hors de l'image)."""
    defauts = []
    for i, p in enumerate(sc.get("plans", []), 1):
        ty = p.get("type")
        if ty not in TYPES:
            defauts.append(f"plan {i} : type inconnu « {ty} »")
            continue
        defauts += [f"plan {i} ({ty}) : champ « {c} » manquant" for c in TYPES[ty] if c not in p]
        noms = p.get("images", []) + ([p["image"]] if "image" in p else [])
        for n in noms:
            if not (base / n).exists():
                defauts.append(f"plan {i} : image absente {base / n}")
                continue
            w, h = Image.open(base / n).size
            rects = list(p.get("bandes", [])) + [t.get("cadre") for t in p.get("temps", []) if t.get("cadre")]
            rects += p.get("flous", []) if isinstance(p.get("flous"), list) else p.get("flous", {}).get(n, [])
            for r in rects:
                if r[0] < 0 or r[1] < 0 or r[2] > w or r[3] > h or r[0] >= r[2] or r[1] >= r[3]:
                    defauts.append(f"plan {i} : rectangle {r} hors de {n} ({w}x{h})")
    if not sc.get("plans"):
        defauts.append("aucun plan")
    return defauts


def trouver_ffmpeg(choix: str | None) -> str | None:
    for c in (choix, os.environ.get("FFMPEG"), shutil.which("ffmpeg")):
        if c and Path(c).exists():
            return c
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def main(argv=None) -> int:
    # Console Windows (cp1252) : l'aide et les messages portent « → » et des accents, qu'elle ne sait pas tous écrire.
    for flux in (sys.stdout, sys.stderr):
        if hasattr(flux, "reconfigure"):
            flux.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("scenario")
    ap.add_argument("--sortie")
    ap.add_argument("--images-cles")
    ap.add_argument("--images-cles-seules", action="store_true")
    ap.add_argument("--ffmpeg")
    ap.add_argument("--script-voix", help="écrit le texte de la voix off pour l'outil de voix, puis s'arrête")
    ap.add_argument("--voix", help="dossier des voix rendues (NN.pcm) : chaque moment est calé sur sa voix")
    a = ap.parse_args(argv)
    chemin = Path(a.scenario)
    sc = json.loads(chemin.read_text(encoding="utf-8"))
    base = Path(sc.get("base") or chemin.parent)
    defauts = verifier_scenario(sc, base)
    if defauts:
        print("\n".join(defauts), file=sys.stderr)
        return 2
    if a.script_voix:
        Path(a.script_voix).write_text(script_voix(sc["plans"]), encoding="utf-8", newline="")
        print(f"{sum(1 for m in segments(sc['plans']) if m.get('voix'))} moments à dire dans {a.script_voix}")
        return 0
    voix: dict[int, bytes] = {}
    if a.voix:
        voix = lire_voix(Path(a.voix))
        attendus = {n for n, m in enumerate(segments(sc["plans"]), 1) if m.get("voix")}
        if attendus - set(voix):
            print(f"voix manquantes dans {a.voix} : moments {sorted(attendus - set(voix))}", file=sys.stderr)
            return 2
        sc = {**sc, "plans": caler_sur_voix(sc["plans"], {n: duree_parlee(b, TAUX_VOIX) for n, b in voix.items()})}
    r = Rendu(sc, base)
    if a.images_cles:
        dossier = Path(a.images_cles)
        dossier.mkdir(parents=True, exist_ok=True)
        for nom, t in r.temps_forts():
            r.image_a(t).save(dossier / f"{nom}.png")
        print(f"{len(r.temps_forts())} images clés dans {dossier}")
    if a.images_cles_seules:
        return 0
    ff = trouver_ffmpeg(a.ffmpeg)
    if not ff:
        print("ffmpeg introuvable (--ffmpeg, FFMPEG, PATH ou pip install imageio-ffmpeg)", file=sys.stderr)
        return 2
    sortie = Path(a.sortie or chemin.with_suffix(".mp4"))
    n = int(round(r.total * r.fps))
    son: list[str] = []
    if voix:
        wav = sortie.with_name(sortie.stem + "-voix.wav")
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(TAUX_VOIX)
            w.writeframes(piste_voix(sc["plans"], voix, TAUX_VOIX))
        son = ["-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    proc = subprocess.Popen([ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{r.W}x{r.H}",
                             "-r", str(r.fps), "-i", "-", *son, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                             "-preset", "medium", "-movflags", "+faststart", str(sortie)], stdin=subprocess.PIPE)
    for f in range(n):
        proc.stdin.write(r.image_a(f / r.fps).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        print("ffmpeg a échoué", file=sys.stderr)
        return 1
    print(f"{sortie} · {r.total:.1f} s · {n} images · {r.W}x{r.H} à {r.fps} i/s" + (f" · voix off sur {len(voix)} moments" if voix else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
