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

PARTI PRIS VISUEL (refait le 2026-10-11, conv-228)
--------------------------------------------------
Demande : « refais la gueule du launcher pour qu'il fasse plus moderne comme ce screenshot ». La
reference montre le LOGO anneau au centre d'un noir violace, un halo violet doux derriere lui, et
« Autowin OS » en gros caracteres gras blancs dessous. L'ecran reprend cette composition, avec les
valeurs MESUREES sur la capture (elles vivent dans `logo_anneau.py`, source unique du logo) :
  - fond et halo sont peints en IMAGE : le canvas tkinter n'a ni alpha, ni degrade, ni lissage ;
  - l'anneau TOURNE lentement — un tour en 6 s. C'est le signe vivant pendant la compilation, role
    que tenait l'atome (« quand je start l'app je veux voir mon spinner », 2026-09-10) ;
  - le titre est rendu par Pillow en Segoe UI Variable Display Bold, lisse comme sur la capture.
Ce qui ne change pas : les petits textes restent DORES (demande utilisateur), et la progression reste
une suite de SEGMENTS — un par etape franchie — et non un pourcentage : un pourcentage de demarrage
serait invente, alors qu'« Compilation de l'interface — 38 s » est une information vraie.
Sans Pillow, l'ecran reste fonctionnel : fond uni, logo fixe, titre en texte tkinter.
"""

from __future__ import annotations

import ctypes
import functools
import math
import queue
import re
import time
import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont

import subprocess

import logo_anneau
from launch_dev_phases import ETAPES, SuiviDemarrage, formater_identite, libelle_duree

if logo_anneau.PILLOW:
    from PIL import Image, ImageDraw, ImageFont, ImageTk

_RACINE_PROJET = Path(__file__).resolve().parent.parent


def _hexa(rvb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rvb


def _rvb(hexa: str) -> tuple[int, int, int]:
    return tuple(int(hexa[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


# PALETTE.
#
#   fond    le noir violace de la capture de reference, LU dans `logo_anneau.FOND` (pas recopie) ;
#   texte   #f5f7fb, le blanc de l'application (`color: #f5f7fb` dans `src/renderer/index.html`) ;
#   dore / rose-violet  LUS dans le degrade de `src/renderer/index.html`.
#
# Les deux teintes d'accent ne sont pas recopiees ici : `src/renderer/index.html` est la source unique
# de la palette du demarrage (elle-meme copie surveillee de `src/shared/boot-splash.ts`, cf.
# `boot-splash.test.ts`). Un hexadecimal recopie a la main derivait en silence : le commit 08016aac a
# change l'app sans que ce lanceur bronche. Lues a la source, les deux ecrans ne PEUVENT plus diverger
# — et si le degrade devient illisible, on le dit au lieu de repeindre avec une valeur devinee.
_ARCS = re.search(
    r"linear-gradient\(\s*(#[0-9a-fA-F]{6})\s+0\s+50%\s*,\s*(#[0-9a-fA-F]{6})",
    (_RACINE_PROJET / "src" / "renderer" / "index.html").read_text(encoding="utf-8"),
)
if _ARCS is None:
    raise SystemExit(
        "src/renderer/index.html ne porte plus le degrade des deux arcs : la palette de "
        "l'ecran de demarrage n'a plus de source. Corriger index.html avant de lancer."
    )
_DORE = _ARCS.group(1)
_VIOLET = _ARCS.group(2)
_FOND = _hexa(logo_anneau.FOND)
_TEXTE = "#f5f7fb"      # le GROS titre et l'etape en cours : blanc
# Le liseré de la fenetre : #f5f7fb a 9 % sur le fond, aplati (tkinter ne connait pas l'alpha).
_FILET = _hexa(tuple(round(f + (t - f) * 0.09) for f, t in zip(logo_anneau.FOND, _rvb(_TEXTE))))  # type: ignore[arg-type]
# Tous les petits textes sont DORES (demande utilisateur) : sous-titre, version, chrono, journal. Un
# gris atone avait ete invente pour "attenuer" : il n'appartenait a aucune palette et ternissait
# l'ecran.
# L'ecran de demarrage de l'app n'a AUCUN etat d'erreur — cette couleur-ci est donc nouvelle. Choisie
# dans la meme famille chaude que le dore pour ne pas jurer, mais assez distincte pour ne pas passer
# pour une etape normale.
_ALERTE = "#e0705a"

_TITRE = "Autowin OS"
_LARGEUR = 520
_HAUTEUR = 440
_MARGE = 44
# Proportions de la capture : anneau de 107 px, titre de 52 px de hauteur de capitale, 52 px entre
# les deux. Ramenees a un anneau de 96 px pour laisser la place aux etapes sous le titre.
_DIAMETRE = 96
_CENTRE = (_LARGEUR // 2, 108)
_HAUT_TITRE = _CENTRE[1] + _DIAMETRE // 2 + 46
_CAPITALE = 46
# Un tour en 6 s : assez lent pour rester calme, assez vif pour prouver que l'ecran vit.
_TOUR_S = 6.0


def _peindre_fond() -> "Image.Image":
    """Le fond de la fenetre en une image : aplat, halo violet, liseré, titre.

    Le halo est la courbe mesuree sur la capture : exp(-r²/s²) avec s = 1,3 x le rayon de l'anneau.
    Au-dela de 2,6 rayons il vaut zero : les etiquettes posees plus bas tombent sur l'aplat exact,
    sans rectangle visible autour d'elles (defaut de la premiere version, halo trop large de √2).
    """
    fond = Image.new("RGB", (_LARGEUR, _HAUTEUR), logo_anneau.FOND)
    s = 1.3 * _DIAMETRE / 2
    petit = 128  # calcule petit (16 000 points) puis agrandi : la courbe est lisse, rien ne se perd
    unite = petit / 6  # le masque couvre ±3 s
    masque = Image.new("L", (petit, petit))
    masque.putdata(
        [
            round(255 * math.exp(-((x + 0.5 - petit / 2) ** 2 + (y + 0.5 - petit / 2) ** 2) / unite**2))
            for y in range(petit)
            for x in range(petit)
        ]
    )
    cote = round(6 * s)
    masque = masque.resize((cote, cote), Image.BICUBIC)
    halo = Image.new("RGB", (cote, cote), logo_anneau.HALO)
    fond.paste(halo, (_CENTRE[0] - cote // 2, _CENTRE[1] - cote // 2), masque)

    trace = ImageDraw.Draw(fond)
    # Liseré CARRE : si Windows 11 arrondit la fenetre (voir `_arrondir_coins`), il trace son propre
    # bord ; un liseré arrondi dessine ici flotterait dans les coins d'une fenetre restee carree.
    trace.rectangle([0, 0, _LARGEUR - 1, _HAUTEUR - 1], outline=_FILET, width=1)
    police = _police_titre()
    if police is not None:
        # Ancre « ms » : milieu horizontal, LIGNE DE BASE verticale — la capitale finit pile la.
        trace.text(
            (_LARGEUR / 2, _HAUT_TITRE + _CAPITALE), _TITRE, font=police, fill=_rvb(_TEXTE), anchor="ms"
        )
    return fond


@functools.lru_cache(maxsize=1)
def _police_titre() -> "ImageFont.FreeTypeFont | None":
    """Segoe UI Variable Display Bold, taillee pour que le « A » mesure `_CAPITALE` px.

    Repli : Segoe UI Bold. Aucune des deux : `None`, le titre passe alors en texte tkinter.
    """
    polices = Path(r"C:\Windows\Fonts")
    for fichier, instance in (("SegUIVar.ttf", b"Bold Display"), ("segoeuib.ttf", None)):
        try:
            essai = ImageFont.truetype(str(polices / fichier), 100)
            if instance is not None:
                essai.set_variation_by_name(instance)
            _, haut, _, bas = essai.getbbox("A")
            taille = round(100 * _CAPITALE / (bas - haut))
            police = ImageFont.truetype(str(polices / fichier), taille)
            if instance is not None:
                police.set_variation_by_name(instance)
            return police
        except Exception:  # noqa: BLE001 - police absente : on essaie la suivante
            continue
    return None


class _AnneauTournant:
    """Les images de l'anneau en rotation, composees sur le fond REEL qu'elles recouvrent.

    Le dessin est fait UNE fois a 2x ; chaque image n'est qu'une rotation puis une reduction (lisse),
    mise en cache par cran de 3 deg. Aucun alpha n'est confie a tkinter : l'image livree est opaque,
    halo compris.
    """

    PAS = 3.0

    def __init__(self, fond: "Image.Image") -> None:
        cote = _DIAMETRE + 4
        gauche, haut = _CENTRE[0] - cote // 2, _CENTRE[1] - cote // 2
        self._dessous = fond.crop((gauche, haut, gauche + cote, haut + cote)).convert("RGBA")
        self._source = logo_anneau.dessiner_anneau(cote * 2, diametre=_DIAMETRE * 2, sur=4).convert("RGBa")
        self._cache: dict[int, "ImageTk.PhotoImage"] = {}

    def image(self, secondes: float) -> "ImageTk.PhotoImage":
        crans = round(360 / self.PAS)
        cran = int((secondes / _TOUR_S) * crans) % crans
        if cran not in self._cache:
            # `rotate` tourne dans le sens TRIGONOMETRIQUE : l'angle negatif fait tourner en horaire.
            tourne = self._source.rotate(-cran * self.PAS, resample=Image.BICUBIC).reduce(2)
            pose = Image.alpha_composite(self._dessous, tourne.convert("RGBA")).convert("RGB")
            self._cache[cran] = ImageTk.PhotoImage(pose)
        return self._cache[cran]


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
        self._franchies = 0

        self.racine = tk.Tk()
        self.racine.title(titre)
        self.racine.configure(bg=_FOND)
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
            self.racine, width=_LARGEUR, height=_HAUTEUR, bg=_FOND, highlightthickness=0, bd=0
        )
        self.toile.pack(fill="both", expand=True)

        # LE FOND ET LE LOGO. Avec Pillow : halo, titre lisse et anneau qui tourne. Sans : le VRAI
        # logo, fixe, et le titre en texte tkinter — un lanceur ne meurt pas pour une image.
        self._fond_pil = _peindre_fond() if logo_anneau.PILLOW else None
        self._anneau: _AnneauTournant | None = None
        if self._fond_pil is not None:
            self._fond_image = ImageTk.PhotoImage(self._fond_pil)
            self.toile.create_image(0, 0, image=self._fond_image, anchor="nw")
            self._anneau = _AnneauTournant(self._fond_pil)
            self._anneau_item = self.toile.create_image(*_CENTRE, image=self._anneau.image(0), anchor="center")
        else:
            self._logo = self._charger_logo()
            if self._logo is not None:
                self.toile.create_image(*_CENTRE, image=self._logo, anchor="center")
        if self._fond_pil is None or _police_titre() is None:
            titre_police = tkfont.Font(family="Segoe UI Variable Display", size=34, weight="bold")
            self.toile.create_text(
                _LARGEUR // 2, _HAUT_TITRE + _CAPITALE, text=_TITRE, fill=_TEXTE, font=titre_police, anchor="s"
            )

        corps = tkfont.Font(family="Segoe UI", size=10)
        etape_police = tkfont.Font(family="Segoe UI Semibold", size=11)
        mono = tkfont.Font(family="Consolas", size=9)
        utile = _LARGEUR - 2 * _MARGE

        y = _HAUT_TITRE + _CAPITALE + 22
        sous_titre = tk.Label(self.toile, text="mode développement", bg=_FOND, fg=_DORE, font=corps)
        self.toile.create_window(_LARGEUR // 2, y, window=sous_titre, anchor="n")
        # QUELLE version : commit + branche + fichiers non committés. En dev, le lanceur build l'arbre
        # vivant — cette ligne rend visible ce qu'on execute reellement, y compris « +N non committés »
        # qui signale que ce n'est PAS exactement le commit affiche.
        version = tk.Label(self.toile, text=self._identite_version(), bg=_FOND, fg=_DORE, font=mono)
        self.toile.create_window(_LARGEUR // 2, y + 22, window=version, anchor="n")

        y += 68
        ligne_etape = tk.Frame(self.toile, bg=_FOND)
        self.toile.create_window(_MARGE, y, window=ligne_etape, anchor="nw", width=utile, height=24)
        self.etiquette_etape = tk.Label(
            ligne_etape, text=self._libelle_courant, bg=_FOND, fg=_TEXTE, font=etape_police
        )
        self.etiquette_etape.pack(side="left")
        self.etiquette_chrono = tk.Label(ligne_etape, text="0 s", bg=_FOND, fg=_DORE, font=mono)
        self.etiquette_chrono.pack(side="right")

        # Un segment par etape REELLEMENT franchie, ajoute au fur et a mesure.
        #
        # La version precedente en dessinait un par etape CONNUE (huit) : trois restaient grises
        # jusqu'au bout, parce que le demarrage ne les traverse pas. L'utilisateur l'a dit —
        # « je sais pas a quoi servent les 3 dernieres barres » — et il avait raison : une case vide
        # promet une etape. Or le nombre d'etapes n'est PAS connu d'avance, l'application publie les
        # siennes (`[demarrage] … ms …`) au fil de son demarrage.
        self.segments = tk.Frame(self.toile, bg=_FOND)
        self.toile.create_window(_MARGE, y + 32, window=self.segments, anchor="nw", width=utile, height=3)
        self._barres: list[tk.Frame] = []

        self.journal = tk.Label(
            self.toile, text="", bg=_FOND, fg=_DORE, font=mono, justify="left", anchor="nw"
        )
        self.toile.create_window(_MARGE, y + 48, window=self.journal, anchor="nw", width=utile, height=64)

        self._arrondir_coins()
        self.racine.after(200, self._battement)
        # L'ANIMATION a son propre rythme : 40 ms (~25 images/s). Le battement des etapes est a
        # 200 ms — a cette cadence, l'anneau sauterait au lieu de tourner.
        self.racine.after(40, self._tourner)

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
        # mise a jour, et son absence ici faisait lire « +32 fichiers » comme « +32 commits ». On ne
        # RAPATRIE rien pour le calculer (`rev-list` sur la ref locale deja connue) : un lanceur ne
        # part pas sur le reseau pour afficher une ligne, sinon il ralentit chaque demarrage.
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

    def _arrondir_coins(self) -> None:
        """Coins arrondis de Windows 11 (DWM), comme les fenetres de l'application.

        Une fenetre sans barre de titre reste carree par defaut. Avant Windows 11, ou hors Windows,
        l'appel echoue : la fenetre reste carree, ce n'est pas une panne.
        """
        try:
            self.racine.update_idletasks()
            hwnd = int(self.racine.wm_frame(), 16)
            preference = ctypes.c_int(2)  # DWMWCP_ROUND
            ctypes.windll.dwmapi.DwmSetWindowAttribute(  # type: ignore[attr-defined]
                hwnd, 33, ctypes.byref(preference), ctypes.sizeof(preference)  # DWMWA_WINDOW_CORNER_PREFERENCE
            )
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
        except tk.TclError:
            self._detruite = True
            return
        # Le controle de fermeture vit ICI, dans le battement, et non dans l'absorption d'une ligne :
        # la fenetre de l'application peut apparaitre sans qu'aucune ligne NOUVELLE n'arrive, et
        # l'ecran d'attente resterait alors ouvert indefiniment.
        if self.suivi.fermer():
            self.fini = True
        if self.fini:
            self._detruite = True
            try:
                self.racine.destroy()
            except tk.TclError:
                pass
            return
        self.racine.after(200, self._battement)

    def _tourner(self) -> None:
        """Fait tourner l'anneau. Se replanifie tant que la fenetre vit."""
        if self._detruite or self._anneau is None:
            return
        try:
            self.toile.itemconfig(self._anneau_item, image=self._anneau.image(time.monotonic() - self._debut))
        except tk.TclError:
            return  # Fenetre en cours de fermeture : une animation ne fait pas echouer un demarrage.
        self.racine.after(40, self._tourner)

    def _absorber(self, ligne: str) -> None:
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
        if not erreur:
            # Un segment de PLUS, jamais une case vide en attente.
            barre = tk.Frame(self.segments, bg=_VIOLET, height=3)
            barre.pack(side="left", fill="both", expand=True, padx=(0, 3))
            self._barres.append(barre)
        for index, barre in enumerate(self._barres):
            dernier = index == len(self._barres) - 1
            barre.config(bg=_ALERTE if erreur else (_VIOLET if dernier else _DORE))
        # Les QUATRE dernieres etapes avec leur duree : c'est ce qui repond a « qu'est-ce qui prend du
        # temps » sans transformer l'ecran en console.
        self.journal.config(
            text="\n".join(f"{nom}   {libelle_duree(duree)}" for nom, duree in self._durees[-4:])
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
