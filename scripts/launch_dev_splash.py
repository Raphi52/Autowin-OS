"""Ecran d'attente du LANCEUR — affiche a la seconde du double-clic.

POURQUOI IL EXISTE, alors que l'application a deja le sien
----------------------------------------------------------
L'ecran d'attente d'Autowin vit DANS Electron : il ne peut donc apparaitre qu'une fois Electron
demarre, c'est-a-dire APRES la compilation. Le test `startup-splash.test.ts` a mesure le trou :
« 30 a 44 secondes s'ecoulaient sans AUCUNE fenetre ». On double-clique, rien ne se passe, on
double-clique encore.

Celui-ci s'ouvre AVANT que `npm run dev` soit lance, et se retire quand l'application prend le relais.

CE QUI DECIDE DE SA FERMETURE (defaut corrige)
----------------------------------------------
La premiere version se fermait des que le bundle etait plus recent que les sources. Or il l'est DEJA
au sortir d'un build : la condition etait vraie a la premiere ligne lue et l'ecran disparaissait
aussitot. La duree de vie appartient a `SuiviDemarrage` (module des etapes), qui distingue deux
questions qu'on avait confondues : « le bundle est-il a jour » (garde anti-perime) et « l'application
est-elle a l'ecran » (seule a devoir fermer cette fenetre).

PARTI PRIS VISUEL (refait le 2026-10-12, conv-903, /draft en six tours, valide sur maquettes)
--------------------------------------------------------------------------------------------
Demande : « une nouvelle barre de login pour le launcher python », precisee en route : « je voulais
changer la barre en elle-meme, elle est bizarre » puis « que le style ressemble plus au theme holo
dans son ensemble ». La barre d'avant etait un TIRET par etape, tous etires sur toute la largeur :
a 52 s, vingt tirets egaux — un pointille, pas une progression (constate sur le rendu reel).
Ce qui a ete choisi, tour par tour :
  - « 6 » : plus de barre. C'est L'ANNEAU qui se remplit, une part par etape franchie, le compte
    « 4/21 » dans son trou ;
  - le style du theme HOLOGRAPHIQUE (`theme-nebuleuse-verre.css`, LU ici, jamais recopie) : panneau
    sombre en degrade, coins haut-gauche et bas-droit COUPES a 45 deg avec leurs pans blanc et
    argent, texte lilas, degrade bleu -> rose, aucun halo ;
  - « 6.3 » : en pied, les DEUX comptes Claude, l'actif en capsule degradee, l'autre a cote ;
  - « 3.5 et 3.6 » : un REFLET blanc balaie la part remplie ; quand il arrive au bout, le bout
    S'ALLUME en rose (le rose « en cours » du theme) ; a chaque etape, le compteur ROULE (3 -> 4) et
    la nouvelle part s'allume en fondu.
Le reflet dit « ca travaille » meme pendant les 38 s de compilation de l'interface ou rien ne se
remplit ; le compteur dit « une etape vient de passer ». Les petits textes ne sont plus dores : le
theme Holo n'a pas d'or (choix « 6 » du tour 3, ou cette consequence etait ecrite sur la maquette).

LE TOTAL DE L'ANNEAU N'EST PAS INVENTE
--------------------------------------
Le nombre d'etapes n'est pas connu d'avance (l'application publie les siennes). L'anneau compte
donc sur le DERNIER lancement reussi, mesure et garde dans `.autowin-data/launch-dev-etapes.json` ;
a defaut, sur le total des etapes CONNUES du module des etapes. Il ne se remplit jamais avant la fin.

Sans Pillow, l'ecran reste fonctionnel : fond uni, logo fixe, textes, pas d'animation.
"""

from __future__ import annotations

import ctypes
import functools
import json
import math
import queue
import re
import time
import tkinter as tk
from ctypes import wintypes
from pathlib import Path
from tkinter import font as tkfont

import subprocess

import logo_anneau
from launch_dev_comptes import (
    autres_comptes,
    basculer,
    initiales,
    ligne_verrouille_bascule,
    lire_comptes,
    nom_court,
    titre_actif,
)
from launch_dev_phases import (
    ETAPES,
    SuiviDemarrage,
    denominateur,
    etapes_connues_total,
    formater_identite,
    libelle_duree,
    ligne_compte_etapes,
)

if logo_anneau.PILLOW:
    from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageTk

_RACINE_PROJET = Path(__file__).resolve().parent.parent
_REFERENCE = _RACINE_PROJET / ".autowin-data" / "launch-dev-etapes.json"
_POLICES = Path(r"C:\Windows\Fonts")


def _hexa(rvb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rvb


def _rvb(hexa: str) -> tuple[int, int, int]:
    return tuple(int(hexa[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def _melange(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))  # type: ignore[return-value]


# PALETTE : LUE dans le theme Holographique, jamais recopiee.
#
# Un hexadecimal recopie a la main derive en silence (le commit 08016aac avait change l'app sans que
# le lanceur bronche). Les jetons sont donc extraits de la feuille du theme ; si l'un d'eux devient
# illisible, on le DIT au lieu de repeindre avec une valeur devinee.
_THEME = _RACINE_PROJET / "src" / "renderer" / "src" / "assets" / "theme-nebuleuse-verre.css"
_HEX = r"(#[0-9a-fA-F]{6})"
_BLANC_ALPHA = r"rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+)\s*\)"


def _jetons_holo(css: str) -> dict[str, str]:
    motifs = {
        "bg-0": rf"--bg-0:\s*{_HEX}",
        "text": rf"--text:\s*{_HEX}",
        "text-dim": rf"--text-dim:\s*{_HEX}",
        "text-faint": rf"--text-faint:\s*{_HEX}",
        "rose-bright": rf"--rose-bright:\s*{_HEX}",
        "err": rf"--err:\s*{_HEX}",
        "line": rf"--line:\s*{_BLANC_ALPHA}",
        "verre-fort": rf"--nv-verre-fort:\s*{_BLANC_ALPHA}",
        "degrade": rf"--nv-degrade:\s*linear-gradient\(\s*135deg\s*,\s*{_HEX}\s*,\s*{_HEX}\s*\)",
        "chanfrein": r"--nv-chanfrein:\s*(\d+)px",
        "chanfrein-pan": r"--nv-chanfrein-pan:\s*(\d+)px",
        "chanfrein-haut": rf"--nv-chanfrein-haut:\s*{_HEX}",
        "chanfrein-bas": rf"--nv-chanfrein-bas:\s*{_HEX}",
        "chanfrein-cotes": rf"--nv-chanfrein-cotes:\s*{_BLANC_ALPHA}",
    }
    jetons: dict[str, str] = {}
    for nom, motif in motifs.items():
        trouve = re.search(motif, css)
        if trouve is None:
            raise SystemExit(
                f"{_THEME.name} ne porte plus le jeton « {nom} » : la palette de l'ecran de demarrage "
                "n'a plus de source. Corriger le theme avant de lancer."
            )
        jetons[nom] = ",".join(trouve.groups())
    return jetons


_JETONS = _jetons_holo(_THEME.read_text(encoding="utf-8"))
_BLANC = (255, 255, 255)
_FOND_BAS = _JETONS["bg-0"]
# Le haut du panneau : le verre FORT du theme pose sur son fond (blanc a 7,5 %), comme les panneaux
# de l'application — mesure #212121 -> #0a0a0a sur une capture du chat en Holo.
_FOND_HAUT = _hexa(_melange(_rvb(_FOND_BAS), _BLANC, float(_JETONS["verre-fort"])))
_TEXTE = _JETONS["text"]
_TEXTE_DIM = _JETONS["text-dim"]
_TEXTE_PALE = _JETONS["text-faint"]
_ROSE_VIF = _JETONS["rose-bright"]
_ALERTE = _JETONS["err"]
_BLEU, _ROSE = _JETONS["degrade"].split(",")
# La piste de l'anneau : le filet du theme (blanc a 11 %) sur son fond — #262626 sur la maquette validee.
_PISTE = _hexa(_melange(_rvb(_FOND_BAS), _BLANC, float(_JETONS["line"])))
# Le fond du pied : un cran sous la piste, comme le cadre des puces du chat.
_CAPSULE = _hexa(_melange(_rvb(_FOND_BAS), _BLANC, float(_JETONS["line"]) * 0.4))
_CHANFREIN = int(_JETONS["chanfrein"])
_CHANFREIN_PAN = int(_JETONS["chanfrein-pan"])
_PAN_HAUT = _JETONS["chanfrein-haut"]
_PAN_BAS = _JETONS["chanfrein-bas"]
_COTES_ALPHA = float(_JETONS["chanfrein-cotes"])
_LIGNE_ALPHA = float(_JETONS["line"])

_TITRE = "Autowin OS"
_LARGEUR = 520
_HAUTEUR = 500
_MARGE = 44
_DIAMETRE = 96
_CENTRE = (_LARGEUR // 2, 108)
_HAUT_TITRE = _CENTRE[1] + _DIAMETRE // 2 + 46
_CAPITALE = 46
_BASE_TITRE = _HAUT_TITRE + _CAPITALE
_Y_SOULIGNE = _BASE_TITRE + 10
_LARGEUR_SOULIGNE = 132
_Y_SOUS_TITRE = _BASE_TITRE + 34
_Y_VERSION = _Y_SOUS_TITRE + 20
_Y_ETAPE = _Y_VERSION + 32
_Y_COMPTE = _Y_ETAPE + 22
_Y_JOURNAL = _Y_COMPTE + 16
_Y_PIED = _HAUTEUR - 60
_PIED = (14, _Y_PIED, _LARGEUR - 14, _Y_PIED + 44)

# LE REFLET (maquettes 3.5 / 3.6) : 26 deg de large, un passage toutes les 1,8 s, apparait sur les
# 12 premiers % du cycle et s'efface sur les 18 derniers ; le bout s'allume de 72 a 100 %, au plus
# fort a 84 % — quand le reflet y arrive.
_PERIODE = 1.8
_LARGEUR_REFLET = 26.0
_OPACITE_REFLET = 0.85
# Le compteur roule et la nouvelle part s'allume en 0,45 s.
_DUREE_PAS = 0.45


def _lisse(u: float) -> float:
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def etat_reflet(t: float, periode: float = _PERIODE) -> tuple[float, float, float]:
    """`(course, opacite, eclat)` du reflet a l'instant `t` (secondes). Pur, donc eprouvable.

    course  : 0 -> 1, ou en est le reflet entre midi et le bout de la part remplie ;
    opacite : le reflet apparait puis s'efface, pour que la boucle ne « saute » pas ;
    eclat   : le bout qui s'allume en rose quand le reflet l'atteint.
    """
    u = (t % periode) / periode
    opacite = u / 0.12 if u < 0.12 else (1.0 if u <= 0.82 else (1 - u) / 0.18)
    if 0.72 <= u < 0.84:
        eclat = (u - 0.72) / 0.12
    elif u >= 0.84:
        eclat = (1 - u) / 0.16
    else:
        eclat = 0.0
    return _lisse(u), min(1.0, max(0.0, opacite)), min(1.0, max(0.0, eclat))


def lire_reference(chemin: Path = _REFERENCE) -> tuple[int, str | None]:
    """Le total du dernier lancement REUSSI et son heure ; a defaut, les etapes connues et `None`."""
    try:
        brut = json.loads(chemin.read_text(encoding="utf-8"))
        etapes, heure = int(brut["etapes"]), str(brut["heure"])
        if etapes >= 1 and re.fullmatch(r"\d{2}:\d{2}", heure):
            return etapes, heure
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return etapes_connues_total(), None


def memoriser_reference(etapes: int, chemin: Path = _REFERENCE) -> None:
    """Garde le total d'un lancement reussi pour le suivant. Un echec d'ecriture ne coute que la
    precision du prochain anneau : il ne doit jamais faire echouer une fermeture."""
    if etapes < 1:
        return
    try:
        chemin.parent.mkdir(parents=True, exist_ok=True)
        chemin.write_bytes(
            json.dumps({"etapes": etapes, "heure": time.strftime("%H:%M")}).encode("utf-8")
        )
    except OSError:
        pass


@functools.lru_cache(maxsize=None)
def _police(fichiers: tuple[str, ...], taille: int) -> "ImageFont.FreeTypeFont | ImageFont.ImageFont":
    for fichier in fichiers:
        try:
            return ImageFont.truetype(str(_POLICES / fichier), taille)
        except OSError:
            continue
    return ImageFont.load_default()


_MONO = ("CascadiaMono.ttf", "consola.ttf")
_SEMI = ("seguisb.ttf", "segoeuib.ttf")
_GRAS = ("segoeuib.ttf",)


def _tronquer(trace: "ImageDraw.ImageDraw", texte: str, police, largeur: float) -> str:
    if trace.textlength(texte, font=police) <= largeur:
        return texte
    while texte and trace.textlength(texte + "…", font=police) > largeur:
        texte = texte[:-1]
    return texte + "…"


def _degrade_h(largeur: int, hauteur: int, gauche: str, droite: str) -> "Image.Image":
    """Degrade horizontal, interpole en RVB comme `linear-gradient` du navigateur."""
    bande = Image.new("RGB", (max(1, largeur), 1))
    bande.putdata([_melange(_rvb(gauche), _rvb(droite), x / max(1, largeur - 1)) for x in range(largeur)])
    return bande.resize((max(1, largeur), max(1, hauteur)))


def _peindre_fond() -> "Image.Image":
    """Le panneau Holo en une image : degrade, cadre aux coins coupes, titre, souligne degrade."""
    fond = Image.new("RGB", (_LARGEUR, _HAUTEUR))
    trace = ImageDraw.Draw(fond)
    haut, bas = _rvb(_FOND_HAUT), _rvb(_FOND_BAS)
    for y in range(_HAUTEUR):
        trace.line([(0, y), (_LARGEUR - 1, y)], fill=_melange(haut, bas, y / (_HAUTEUR - 1)))

    # Le cadre « chanfrein platine » du theme : cotes a blanc 7 %, et seuls les deux PANS coupes
    # s'allument — blanc en haut a gauche, argent en bas a droite, prolonges d'un pan le long des bords.
    c, p, d, b = _CHANFREIN, _CHANFREIN_PAN, _LARGEUR - 1, _HAUTEUR - 1
    voile = Image.new("RGBA", (_LARGEUR, _HAUTEUR), (0, 0, 0, 0))
    ImageDraw.Draw(voile).line(
        [(c, 0), (d, 0), (d, b - c), (d - c, b), (0, b), (0, c), (c, 0)],
        fill=(255, 255, 255, round(255 * _COTES_ALPHA)),
        width=1,
    )
    fond = Image.alpha_composite(fond.convert("RGBA"), voile).convert("RGB")
    trace = ImageDraw.Draw(fond)
    trace.line([(0, c + p), (0, c), (c, 0), (c + p, 0)], fill=_rvb(_PAN_HAUT), width=1)
    trace.line([(d, b - c - p), (d, b - c), (d - c, b), (d - c - p, b)], fill=_rvb(_PAN_BAS), width=1)

    police = _police_titre()
    if police is not None:
        # Ancre « ms » : milieu horizontal, LIGNE DE BASE verticale — la capitale finit pile la.
        trace.text((_LARGEUR / 2, _BASE_TITRE), _TITRE, font=police, fill=_rvb(_TEXTE), anchor="ms")
    # Le souligne degrade de « Autowin OS » dans le menu de l'application.
    fond.paste(
        _degrade_h(_LARGEUR_SOULIGNE, 2, _BLEU, _ROSE),
        (_LARGEUR // 2 - _LARGEUR_SOULIGNE // 2, _Y_SOULIGNE),
    )
    return fond


@functools.lru_cache(maxsize=1)
def _police_titre() -> "ImageFont.FreeTypeFont | None":
    """Segoe UI Variable Display Bold, taillee pour que le « A » mesure `_CAPITALE` px.

    Repli : Segoe UI Bold. Aucune des deux : `None`, le titre passe alors en texte tkinter.
    """
    for fichier, instance in (("SegUIVar.ttf", b"Bold Display"), ("segoeuib.ttf", None)):
        try:
            essai = ImageFont.truetype(str(_POLICES / fichier), 100)
            if instance is not None:
                essai.set_variation_by_name(instance)
            _, haut, _, bas = essai.getbbox("A")
            taille = round(100 * _CAPITALE / (bas - haut))
            police = ImageFont.truetype(str(_POLICES / fichier), taille)
            if instance is not None:
                police.set_variation_by_name(instance)
            return police
        except Exception:  # noqa: BLE001 - police absente : on essaie la suivante
            continue
    return None


def peindre_pied(comptes, actif: str | None, largeur: int = _PIED[2] - _PIED[0]):
    """Le pied « 6.3 » : `(image RGBA, zones)`. `zones` = `[(x0, x1, id du compte), ...]`, pour
    savoir quel compte un clic designe. `(None, [])` sans compte lisible : le pied se cache.

    Dessine a 3x puis reduit : Pillow ne lisse pas les bords des formes arrondies.
    """
    compte_actif = next((c for c in comptes if c.id == actif), None)
    if compte_actif is None:
        return None, []
    s, h = 3, 44
    image = Image.new("RGBA", (largeur * s, h * s), (0, 0, 0, 0))
    trace = ImageDraw.Draw(image)
    trace.rounded_rectangle(
        [0, 0, largeur * s - 1, h * s - 1],
        radius=22 * s,
        fill=_rvb(_CAPSULE) + (255,),
        outline=(255, 255, 255, round(255 * _LIGNE_ALPHA)),
        width=s,
    )
    autres = autres_comptes(comptes, actif)
    interieur = largeur - 6
    largeur_actif = interieur if not autres else round((interieur - 4) * 1.7 / 2.7)
    x0, y0, haut = 3, 3, 38

    # Capsule ACTIVE : le degrade signature du theme, comme « Nouveau fil ».
    capsule = _degrade_h(largeur_actif * s, haut * s, _BLEU, _ROSE).convert("RGBA")
    forme = Image.new("L", capsule.size, 0)
    ImageDraw.Draw(forme).rounded_rectangle([0, 0, capsule.width - 1, capsule.height - 1], radius=19 * s, fill=255)
    capsule.putalpha(forme)
    image.alpha_composite(capsule, (x0 * s, y0 * s))
    cx, cy, r = (x0 + 4 + 12) * s, (y0 + 19) * s, 12 * s
    trace.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    trace.text((cx, cy), initiales(compte_actif), font=_police(_GRAS, 10 * s), fill=_rvb(_BLEU), anchor="mm")
    gauche = (x0 + 4 + 24 + 8) * s
    place = (x0 + largeur_actif - 14) * s - gauche
    titre = _police(_SEMI, 12 * s)
    mono = _police(_MONO, 11 * s)
    trace.text((gauche, (y0 + 17) * s), _tronquer(trace, titre_actif(compte_actif), titre, place),
               font=titre, fill=(255, 255, 255, 255), anchor="ls")
    if compte_actif.email:
        trace.text((gauche, (y0 + 31) * s), _tronquer(trace, compte_actif.email, mono, place),
                   font=mono, fill=(255, 255, 255, 205), anchor="ls")
    zones = [(x0, x0 + largeur_actif, compte_actif.id)]

    if autres:
        autre = autres[0]
        debut = x0 + largeur_actif + 4
        nom = nom_court(autre) + (f"  +{len(autres) - 1}" if len(autres) > 1 else "")
        place = (largeur - 3 - 12 - debut - 12) * s
        trace.text(((debut + 12) * s, (y0 + 17) * s), _tronquer(trace, nom, titre, place),
                   font=titre, fill=_rvb(_TEXTE_DIM) + (255,), anchor="ls")
        if autre.niveau:
            trace.text(((debut + 12) * s, (y0 + 31) * s), _tronquer(trace, autre.niveau, mono, place),
                       font=mono, fill=_rvb(_TEXTE_PALE) + (255,), anchor="ls")
        zones.append((debut, largeur - 3, autre.id))
    return image.convert("RGBa").reduce(s).convert("RGBA"), zones


class _Anneau:
    """L'anneau qui se remplit, son reflet, son bout qui s'allume et son compteur qui roule.

    Compose a 2x puis reduit (bords lisses), sur le fond REEL qu'il recouvre : aucun alpha n'est
    confie a tkinter. Le cadre fait 140 px et non 96 : la lueur du bout deborde de l'anneau.
    """

    S = 2
    COTE = 140

    def __init__(self, fond: "Image.Image") -> None:
        c, s = self.COTE, self.S
        self.coin = (_CENTRE[0] - c // 2, _CENTRE[1] - c // 2)
        self._dessous = fond.crop((*self.coin, self.coin[0] + c, self.coin[1] + c)).convert("RGBA")
        cs = c * s
        self._cs = cs
        self._arc_en_ciel = logo_anneau.dessiner_anneau(cs, diametre=_DIAMETRE * s, sur=4)
        self._alpha = self._arc_en_ciel.getchannel("A")
        self._piste = Image.new("RGBA", (cs, cs), _rvb(_PISTE) + (255,))
        self._piste.putalpha(self._alpha)
        self._r_ext = _DIAMETRE * s / 2
        self._r_moyen = self._r_ext * (1 + logo_anneau.TROU) / 2
        r_trou = self._r_ext * logo_anneau.TROU
        self._trou = Image.new("L", (cs, cs), 0)
        ImageDraw.Draw(self._trou).ellipse([cs / 2 - r_trou, cs / 2 - r_trou, cs / 2 + r_trou, cs / 2 + r_trou], fill=255)
        self._lueur = self._peindre_lueur(20 * s)
        self._police = _police(_MONO, 13 * s)
        self._textes: dict[str, "Image.Image"] = {}
        self._plans: dict[tuple[int, int, int], tuple["Image.Image", ...]] = {}

    def _couche(self, couleur: tuple[int, int, int], alpha: "Image.Image", force: float) -> "Image.Image":
        """Un aplat `couleur` dont l'alpha est `alpha` x `force`. Plans RVB gardes en cache : cette
        methode tourne 25 fois par seconde."""
        if couleur not in self._plans:
            self._plans[couleur] = Image.new("RGB", (self._cs, self._cs), couleur).split()
        return Image.merge("RGBA", (*self._plans[couleur], alpha.point(lambda v: round(v * force))))

    @staticmethod
    def _peindre_lueur(rayon: int) -> "Image.Image":
        """Halo rose du bout : 95 % au centre, 35 % a mi-rayon, 0 au bord (celui de la maquette)."""
        petit = 48
        valeurs = []
        for y in range(petit):
            for x in range(petit):
                d = math.hypot(x + 0.5 - petit / 2, y + 0.5 - petit / 2) / (petit / 2)
                a = 0.95 - (0.95 - 0.35) * d / 0.55 if d < 0.55 else max(0.0, 0.35 * (1 - (d - 0.55) / 0.45))
                valeurs.append(round(255 * a))
        masque = Image.new("L", (petit, petit))
        masque.putdata(valeurs)
        lueur = Image.new("RGBA", (2 * rayon, 2 * rayon), _rvb(_ROSE_VIF) + (255,))
        lueur.putalpha(masque.resize((2 * rayon, 2 * rayon), Image.BICUBIC))
        return lueur

    def _secteur(self, debut: float, fin: float) -> "Image.Image":
        """Masque L du secteur [debut, fin] (degres depuis midi, sens horaire)."""
        masque = Image.new("L", (self._cs, self._cs), 0)
        if fin - debut <= 0:
            return masque
        r = self._r_ext + 2
        boite = [self._cs / 2 - r, self._cs / 2 - r, self._cs / 2 + r, self._cs / 2 + r]
        trace = ImageDraw.Draw(masque)
        if fin - debut >= 360:
            trace.ellipse(boite, fill=255)
        else:
            trace.pieslice(boite, debut - 90, fin - 90, fill=255)
        return masque

    def _texte(self, texte: str) -> "Image.Image":
        if texte not in self._textes:
            bbox = self._police.getbbox(texte)
            image = Image.new("RGBA", (bbox[2] - bbox[0] + 4, bbox[3] - bbox[1] + 4), (0, 0, 0, 0))
            ImageDraw.Draw(image).text((2 - bbox[0], 2 - bbox[1]), texte, font=self._police, fill=_rvb(_TEXTE))
            self._textes[texte] = image
        return self._textes[texte]

    def image(self, franchies: int, precedentes: int, total: int, total_prec: int,
              t: float, depuis_pas: float, erreur: bool) -> "Image.Image":
        """L'image RGB du cadre a l'instant `t`."""
        cs, s = self._cs, self.S
        bascule = _lisse(depuis_pas / _DUREE_PAS)
        fin = 360.0 * min(franchies, total) / total
        fin_prec = min(fin, 360.0 * min(precedentes, total_prec) / total_prec)
        couche = self._piste.copy()

        # La part remplie : ce qui etait deja franchi, plus la nouvelle part qui s'allume en fondu.
        rempli = self._secteur(0, fin_prec)
        if fin > fin_prec:
            nouvelle = self._secteur(fin_prec, fin).point(lambda v: round(v * bascule))
            rempli = ImageChops.lighter(rempli, nouvelle)
        alpha_rempli = ImageChops.multiply(self._alpha, rempli)
        arc = self._arc_en_ciel.copy()
        arc.putalpha(alpha_rempli)
        couche.alpha_composite(arc)

        course, opacite, eclat = etat_reflet(t)
        if not erreur:
            largeur = min(_LARGEUR_REFLET, fin)
            if largeur > 0:
                depart = course * (fin - largeur)
                reflet = ImageChops.multiply(self._secteur(depart, depart + largeur), alpha_rempli)
                couche.alpha_composite(self._couche(_BLANC, reflet, _OPACITE_REFLET * opacite))
            else:
                # Rien de franchi encore : le reflet fait le tour de la piste, discret.
                depart = course * (360 - _LARGEUR_REFLET)
                reflet = ImageChops.multiply(self._secteur(depart, depart + _LARGEUR_REFLET), self._alpha)
                couche.alpha_composite(self._couche(_BLANC, reflet, 0.3 * opacite))
        # Le bout : rose quand le reflet l'atteint ; rouge FIXE si le demarrage a echoue.
        if fin > 0:
            teinte, force = (_ALERTE, 1.0) if erreur else (_ROSE_VIF, eclat)
            if force > 0:
                angle = math.radians(fin)
                bx = cs / 2 + self._r_moyen * math.sin(angle)
                by = cs / 2 - self._r_moyen * math.cos(angle)
                if not erreur:
                    lueur = self._lueur.copy()
                    lueur.putalpha(lueur.getchannel("A").point(lambda v: round(v * force)))
                    couche.alpha_composite(lueur, (round(bx - lueur.width / 2), round(by - lueur.height / 2)))
                bout = ImageChops.multiply(self._secteur(max(0.0, fin - 10), fin + 3), self._alpha)
                couche.alpha_composite(self._couche(_rvb(teinte), bout, force))

        # Le compteur, dans le trou. A chaque etape, l'ancien monte et sort, le nouveau arrive.
        nouveau = self._texte(f"{franchies}/{total}")
        textes = Image.new("RGBA", (cs, cs), (0, 0, 0, 0))
        pas = 28 * s
        centre_y = cs // 2 + s
        if franchies != precedentes and bascule < 1:
            ancien = self._texte(f"{precedentes}/{total_prec}")
            dy = round(pas * bascule)
            textes.alpha_composite(ancien, ((cs - ancien.width) // 2, centre_y - ancien.height // 2 - dy))
            textes.alpha_composite(nouveau, ((cs - nouveau.width) // 2, centre_y - nouveau.height // 2 + pas - dy))
        else:
            textes.alpha_composite(nouveau, ((cs - nouveau.width) // 2, centre_y - nouveau.height // 2))
        textes.putalpha(ImageChops.multiply(textes.getchannel("A"), self._trou))
        couche.alpha_composite(textes)

        # Alpha PREMULTIPLIE pendant la reduction, sinon les bords s'assombrissent d'un liseré.
        petit = couche.convert("RGBa").reduce(s).convert("RGBA")
        return Image.alpha_composite(self._dessous, petit).convert("RGB")


class _TexteToile:
    """Un texte de la toile, lu et change comme une etiquette (`cget` / `config`).

    Les textes sont poses SUR le degrade du panneau : une etiquette tkinter a un fond opaque et
    dessinerait un rectangle. Cette enveloppe garde l'interface des etiquettes d'avant.
    """

    def __init__(self, toile: tk.Canvas, item: int) -> None:
        self._toile, self._item = toile, item

    def cget(self, cle: str) -> str:
        return self._toile.itemcget(self._item, "fill" if cle == "fg" else cle)

    def config(self, text: str | None = None, fg: str | None = None) -> None:
        options = {}
        if text is not None:
            options["text"] = text
        if fg is not None:
            options["fill"] = fg
        self._toile.itemconfig(self._item, **options)


class Splash:
    """Fenetre d'attente. Les lignes arrivent par une file : le lecteur de sortie vit dans un thread."""

    def __init__(self, titre: str = "Autowin OS") -> None:
        self.lignes: queue.Queue[str] = queue.Queue()
        self.suivi = SuiviDemarrage()
        self.fini = False
        self._detruite = False
        self._debut = time.monotonic()
        self._etape_debut = self._debut
        self._libelle_courant = "Préparation du lancement"
        self._durees: list[tuple[str, float]] = []
        # L'anneau : etapes franchies, la valeur d'avant (pour le roulement) et l'instant du pas.
        self._franchies = 0
        self._precedentes = 0
        self._instant_pas = self._debut - 10
        self._erreur = False
        self._reference, self._heure_reference = lire_reference()
        self._total_prec = self._total()
        # Le pied : comptes lus dans le fichier de l'application, bascule verrouillee des qu'Electron part.
        self._comptes, self._actif = lire_comptes()
        self._zones: list[tuple[int, int, str]] = []
        self._bascule_verrouillee = False
        self._message: tuple[str, float] | None = None

        self.racine = tk.Tk()
        self.racine.title(titre)
        self.racine.configure(bg=_FOND_HAUT)
        # Sans barre de titre : l'ecran doit ressembler a l'application, pas a une boite de dialogue.
        # Contrepartie assumee, donc compensee juste apres : la fenetre reste DEPLACABLE et `Echap`
        # la ferme. Une fenetre qu'on ne peut ni bouger ni fermer est une fenetre dont on se mefie.
        self.racine.overrideredirect(True)
        self.racine.attributes("-topmost", True)
        self._centrer()
        self.racine.bind("<Escape>", lambda _: self.terminer())
        self.racine.bind("<Button-1>", self._prise)
        self.racine.bind("<B1-Motion>", self._glisse)

        self.toile = tk.Canvas(
            self.racine, width=_LARGEUR, height=_HAUTEUR, bg=_FOND_HAUT, highlightthickness=0, bd=0
        )
        self.toile.pack(fill="both", expand=True)

        # LE FOND ET L'ANNEAU. Avec Pillow : panneau Holo et anneau anime. Sans : le VRAI logo, fixe,
        # et le titre en texte tkinter — un lanceur ne meurt pas pour une image.
        self._fond_pil = _peindre_fond() if logo_anneau.PILLOW else None
        self._anneau: _Anneau | None = None
        if self._fond_pil is not None:
            self._fond_image = ImageTk.PhotoImage(self._fond_pil)
            self.toile.create_image(0, 0, image=self._fond_image, anchor="nw")
            self._anneau = _Anneau(self._fond_pil)
            self._image_anneau = ImageTk.PhotoImage(self._image_de_l_anneau())
            self._anneau_item = self.toile.create_image(*self._anneau.coin, image=self._image_anneau, anchor="nw")
        else:
            self._logo = self._charger_logo()
            if self._logo is not None:
                self.toile.create_image(*_CENTRE, image=self._logo, anchor="center")
        if self._fond_pil is None or _police_titre() is None:
            titre_police = tkfont.Font(family="Segoe UI Variable Display", size=34, weight="bold")
            self.toile.create_text(
                _LARGEUR // 2, _BASE_TITRE, text=_TITRE, fill=_TEXTE, font=titre_police, anchor="s"
            )

        corps = tkfont.Font(family="Segoe UI", size=10)
        etape_police = tkfont.Font(family="Segoe UI Semibold", size=11)
        mono = tkfont.Font(family="Cascadia Mono", size=9)
        texte = self.toile.create_text  # raccourci

        texte(_LARGEUR // 2, _Y_SOUS_TITRE, text="mode développement", fill=_TEXTE_DIM, font=corps)
        # QUELLE version : commit + branche + fichiers non committes. En dev, le lanceur build l'arbre
        # vivant — cette ligne rend visible ce qu'on execute reellement.
        texte(_LARGEUR // 2, _Y_VERSION, text=self._identite_version(), fill=_TEXTE_PALE, font=mono)
        self.etiquette_etape = _TexteToile(
            self.toile, texte(_MARGE, _Y_ETAPE, text=self._libelle_courant, fill=_TEXTE, font=etape_police, anchor="w")
        )
        self.etiquette_chrono = _TexteToile(
            self.toile, texte(_LARGEUR - _MARGE, _Y_ETAPE, text="0 s", fill=_TEXTE_DIM, font=mono, anchor="e")
        )
        self.ligne_compte = _TexteToile(
            self.toile, texte(_MARGE, _Y_COMPTE, text=self._texte_compte(), fill=_TEXTE_PALE, font=mono, anchor="w")
        )
        # Les TROIS dernieres etapes avec leur duree : la reponse a « qu'est-ce qui prend du temps ».
        # Trois et non quatre : la quatrieme ligne sortait du bas de la fenetre (vu au rendu reel).
        self.journal = _TexteToile(
            self.toile,
            texte(_MARGE, _Y_JOURNAL, text="", fill=_TEXTE_PALE, font=mono, anchor="nw", width=_LARGEUR - 2 * _MARGE),
        )

        self._pied_item: int | None = None
        self._dessiner_pied()

        self._couper_coins()
        self.racine.after(200, self._battement)
        # L'ANIMATION a son propre rythme : 40 ms (~25 images/s). Le battement des etapes est a
        # 200 ms — a cette cadence, le reflet sauterait au lieu de glisser.
        self.racine.after(40, self._tourner)

    # -- anneau et textes --------------------------------------------------------------------------
    def _total(self) -> int:
        return denominateur(self._reference, self._franchies)

    def _texte_compte(self) -> str:
        if self._message is not None and time.monotonic() < self._message[1]:
            return self._message[0]
        return ligne_compte_etapes(self._franchies, self._reference, self._heure_reference)

    def _image_de_l_anneau(self) -> "Image.Image":
        maintenant = time.monotonic()
        return self._anneau.image(  # type: ignore[union-attr]
            self._franchies,
            self._precedentes,
            self._total(),
            self._total_prec,
            maintenant - self._debut,
            maintenant - self._instant_pas,
            self._erreur,
        )

    # -- pied : les deux comptes -----------------------------------------------------------------
    def _dessiner_pied(self) -> None:
        if self._pied_item is not None:
            self.toile.delete(self._pied_item)
            self._pied_item = None
        if self._fond_pil is None:
            actif = next((c for c in self._comptes if c.id == self._actif), None)
            if actif is not None:
                self._pied_item = self.toile.create_text(
                    _PIED[0] + 16, _PIED[1] + 22, anchor="w", fill=_TEXTE_DIM,
                    text=f"compte : {actif.email or nom_court(actif)}"
                         + (f" · {actif.niveau}" if actif.niveau else ""),
                )
            return
        pied, self._zones = peindre_pied(self._comptes, self._actif)
        if pied is None:
            return
        dessous = self._fond_pil.crop(_PIED).convert("RGBA")
        self._image_pied = ImageTk.PhotoImage(Image.alpha_composite(dessous, pied).convert("RGB"))
        self._pied_item = self.toile.create_image(_PIED[0], _PIED[1], image=self._image_pied, anchor="nw")
        if not getattr(self, "_pied_ecoute", False):
            # Liaison posee UNE fois sur la toile, avec un test de position (`_compte_sous`) : le pied
            # se redessine apres chaque bascule sans avoir a re-lier une nouvelle image.
            self.toile.bind("<Button-1>", self._clic_pied, add="+")
            self.toile.bind("<Motion>", self._survol_pied, add="+")
            self._pied_ecoute = True

    def _compte_sous(self, x: int, y: int) -> str | None:
        if not (_PIED[1] <= y < _PIED[3]):
            return None
        x -= _PIED[0]
        return next((ident for debut, fin, ident in self._zones if debut <= x < fin), None)

    def _survol_pied(self, event: tk.Event) -> None:
        cible = self._compte_sous(event.x, event.y)
        main = cible is not None and cible != self._actif and not self._bascule_verrouillee
        self.toile.config(cursor="hand2" if main else "")

    def _clic_pied(self, event: tk.Event) -> None:
        cible = self._compte_sous(event.x, event.y)
        if cible is None or cible == self._actif:
            return
        if self._bascule_verrouillee:
            # Le store de l'app a deja lu le fichier : ecrire maintenant serait ignore puis ecrase.
            self._annoncer("trop tard ici : l'app a déjà lu son compte — change-le dans l'app")
            return
        if not basculer(cible):
            self._annoncer("bascule impossible : fichier des comptes illisible")
            return
        self._comptes, self._actif = lire_comptes()
        self._dessiner_pied()
        actif = next((c for c in self._comptes if c.id == self._actif), None)
        if actif is not None:
            self._annoncer(f"compte actif : {titre_actif(actif)}")

    def _annoncer(self, texte: str) -> None:
        self._message = (texte, time.monotonic() + 3.5)
        try:
            self.ligne_compte.config(text=texte)
        except tk.TclError:
            pass

    # -- fenetre ---------------------------------------------------------------------------------
    def _identite_version(self) -> str:
        """Lit git (impur) et delegue le formatage a `formater_identite` (pur, teste). Toute panne git
        rend une ligne neutre plutot que d'empecher le demarrage — un lanceur ne meurt pas pour un
        `git` absent ou un dossier hors depot."""
        def _git(args: list[str]) -> str:
            try:
                return subprocess.run(
                    ["git", *args],
                    cwd=str(_RACINE_PROJET),
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                ).stdout.strip()
            except Exception:  # noqa: BLE001 - git indisponible ne doit pas bloquer le lanceur
                return ""

        commit = _git(["rev-parse", "--short", "HEAD"])
        if not commit:
            return "version git indisponible"
        branche = _git(["rev-parse", "--abbrev-ref", "HEAD"])
        porcelain = _git(["status", "--porcelain"])
        non_committes = len([l for l in porcelain.splitlines() if l.strip()])
        # RETARD sur la reference distante : c'est le chiffre que l'app affiche dans son bouton de
        # mise a jour. On ne RAPATRIE rien pour le calculer (`rev-list` sur la ref locale deja
        # connue) : un lanceur ne part pas sur le reseau pour afficher une ligne.
        brut = _git(["rev-list", "--count", "HEAD..origin/main"])
        retard = int(brut) if brut.isdigit() else None
        return formater_identite(commit, branche, non_committes, retard)

    def _charger_logo(self) -> tk.PhotoImage | None:
        """Repli quand Pillow manque : le VRAI logo du produit, fixe.

        Absent ou illisible : on s'en passe, on n'echoue pas pour une image.
        """
        chemin = _RACINE_PROJET / "resources" / "autowin-os-dev.png"
        try:
            image = tk.PhotoImage(file=str(chemin))
        except Exception:  # noqa: BLE001 - un logo manquant ne doit pas empecher le demarrage
            return None
        facteur = max(1, image.width() // _DIAMETRE)
        return image.subsample(facteur, facteur)

    def _couper_coins(self) -> None:
        """Coupe les coins haut-gauche et bas-droit a 45 deg, comme les panneaux du theme Holo.

        Une REGION de fenetre Windows : hors du polygone, la fenetre n'existe pas (ni dessin ni
        clic). Hors Windows, ou si l'appel echoue, la fenetre reste rectangulaire — le cadre peint
        porte toujours ses pans : un coin carre ne doit pas empecher le demarrage.
        """
        try:
            self.racine.update_idletasks()
            hwnd = int(self.racine.wm_frame(), 16)
            c, l, h = _CHANFREIN, _LARGEUR, _HAUTEUR
            sommets = ((c, 0), (l, 0), (l, h - c), (l - c, h), (0, h), (0, c))
            points = (wintypes.POINT * len(sommets))(*(wintypes.POINT(x, y) for x, y in sommets))
            region = ctypes.windll.gdi32.CreatePolygonRgn(points, len(sommets), 1)  # type: ignore[attr-defined]
            if region:
                # La fenetre devient proprietaire de la region : ne pas la liberer ici.
                ctypes.windll.user32.SetWindowRgn(hwnd, region, True)  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 - un coin carre ne doit pas empecher le demarrage
            pass

    def _centrer(self) -> None:
        ecran_l = self.racine.winfo_screenwidth()
        ecran_h = self.racine.winfo_screenheight()
        self.racine.geometry(
            f"{_LARGEUR}x{_HAUTEUR}+{(ecran_l - _LARGEUR) // 2}+{(ecran_h - _HAUTEUR) // 3}"
        )

    def _prise(self, event: tk.Event) -> None:
        self._prise_x, self._prise_y = event.x_root, event.y_root
        self._origine = (self.racine.winfo_x(), self.racine.winfo_y())

    def _glisse(self, event: tk.Event) -> None:
        if not hasattr(self, "_origine"):
            return
        x = self._origine[0] + (event.x_root - self._prise_x)
        y = self._origine[1] + (event.y_root - self._prise_y)
        self.racine.geometry(f"+{x}+{y}")

    # -- boucle ----------------------------------------------------------------------------------
    def _battement(self) -> None:
        """Vide la file, met a jour l'affichage, se replanifie. Tout le tkinter reste sur CE thread.

        Tolere une fenetre DEJA detruite : `terminer()` peut etre appele par le veilleur juste avant
        qu'un battement planifie n'arrive, et configurer un widget mort leve `TclError`.
        """
        if self._detruite:
            return
        while True:
            try:
                ligne = self.lignes.get_nowait()
            except queue.Empty:
                break
            self._absorber(ligne)

        try:
            self.etiquette_chrono.config(text=libelle_duree(time.monotonic() - self._etape_debut))
            self.ligne_compte.config(text=self._texte_compte())
        except tk.TclError:
            self._detruite = True
            return
        # Le controle de fermeture vit ICI, dans le battement, et non dans l'absorption d'une ligne :
        # la fenetre de l'application peut apparaitre sans qu'aucune ligne NOUVELLE n'arrive, et
        # l'ecran d'attente resterait alors ouvert indefiniment.
        if self.suivi.fermer():
            self.fini = True
        if self.fini:
            # Un lancement REUSSI devient la reference du prochain anneau.
            if self.suivi.app_affichee and not self._erreur:
                memoriser_reference(self._franchies)
            self._detruite = True
            try:
                self.racine.destroy()
            except tk.TclError:
                pass
            return
        self.racine.after(200, self._battement)

    def _tourner(self) -> None:
        """Anime l'anneau. Se replanifie tant que la fenetre vit."""
        if self._detruite or self._anneau is None:
            return
        try:
            self._image_anneau = ImageTk.PhotoImage(self._image_de_l_anneau())
            self.toile.itemconfig(self._anneau_item, image=self._image_anneau)
        except tk.TclError:
            return  # Fenetre en cours de fermeture : une animation ne fait pas echouer un demarrage.
        self.racine.after(40, self._tourner)

    def _absorber(self, ligne: str) -> None:
        if not self._bascule_verrouillee and ligne_verrouille_bascule(ligne):
            self._bascule_verrouillee = True
        retenue = self.suivi.voir_ligne(ligne)
        if not retenue:
            return
        cle, libelle = retenue
        maintenant = time.monotonic()
        self._durees.append((self._libelle_courant, maintenant - self._etape_debut))
        self._libelle_courant = libelle
        self._etape_debut = maintenant
        erreur = cle == "erreur"
        self.etiquette_etape.config(text=libelle, fg=_ALERTE if erreur else _TEXTE)
        if erreur:
            self._erreur = True
        else:
            # Une part de PLUS, et le compteur roule depuis la valeur affichee jusque-la.
            self._total_prec = self._total()
            self._precedentes = self._franchies
            self._franchies += 1
            self._instant_pas = maintenant
        self.ligne_compte.config(text=self._texte_compte())
        self.journal.config(
            text="\n".join(f"{nom} · {libelle_duree(duree)}" for nom, duree in self._durees[-3:])
        )
        # La fermeture est evaluee a chaque battement (voir `_battement`), pas seulement ici : une
        # ligne retenue n'est pas la seule occasion d'apprendre que l'application est la.

    # -- pilotage --------------------------------------------------------------------------------
    def pousser(self, ligne: str) -> None:
        """Appelable depuis un AUTRE thread : une file, pas un appel tkinter direct."""
        self.lignes.put(ligne)

    def bundle_frais(self, frais: bool) -> None:
        self.suivi.voir_bundle(frais)

    def terminer(self) -> None:
        self.fini = True

    def attendre(self) -> None:
        try:
            self.racine.mainloop()
        except tk.TclError:
            pass  # Fenetre deja detruite : fin normale, rien a signaler.


def etapes_connues() -> tuple[str, ...]:
    """Libelles affichables, pour qu'un test verifie qu'aucune etape n'est muette."""
    return tuple(libelle for _, libelle, _ in ETAPES)
