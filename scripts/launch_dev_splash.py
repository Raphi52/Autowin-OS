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

PARTI PRIS VISUEL
-----------------
Direction LINEAIRE : une carte sombre, un filet d'un pixel, un accent vertical, de l'espace. Aucun
halo, aucun degrade flou. La progression est une suite de SEGMENTS — un par etape franchie — et non
une barre en pourcentage : un pourcentage de demarrage serait invente, alors qu'« Compilation de
l'interface — 38 s » est une information vraie.
"""

from __future__ import annotations

import queue
import time
import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont

from launch_dev_phases import ETAPES, SuiviDemarrage, libelle_duree

# PALETTE — la MEME que l'ecran de demarrage de l'application, relue dans `src/renderer/index.html`
# plutot que devinee. Les deux ecrans se suivent a l'oeil pendant un demarrage : deux codes couleur
# differents feraient croire a deux produits.
#
#   fond    #000        (`html, body { background: #000 }`)
#   texte   #f5f7fb     (`color: #f5f7fb`)
#   piste   rgba(245,247,251,0.07) -> tkinter ne connait pas l'alpha, donc l'equivalent OPAQUE sur noir
#   arc A   #e9bd4e     dore
#   arc B   #9d79ed     rose-violet
#
# Le test `launch_dev_phases_test.py` relit ces valeurs dans `index.html` et refuse une derive : sans
# lui, les deux palettes divergeraient au premier changement de theme cote app.
_FOND = "#000000"
_CARTE = "#000000"
_FILET = "#1c1d1f"      # #f5f7fb a 7 % sur noir, aplati
_TEXTE = "#f5f7fb"      # le GROS titre, et lui seul : blanc
# Tous les petits textes sont DORES (demande utilisateur) : sous-titre, chrono, detail d'erreur. Le
# gris atone d'avant ne venait d'aucune des deux palettes — c'etait une teinte inventee pour
# "atténuer", et elle donnait un ecran terne la ou l'app est noire et doree.
_DORE = "#e9bd4e"
_VIOLET = "#9d79ed"
# L'ecran de demarrage de l'app n'a AUCUN etat d'erreur — cette couleur-ci est donc nouvelle. Choisie
# dans la meme famille chaude que le dore pour ne pas jurer, mais assez distincte pour ne pas passer
# pour une etape normale.
_ALERTE = "#e0705a"

_LARGEUR = 560
_HAUTEUR = 300
_RACINE_PROJET = Path(__file__).resolve().parent.parent


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

        carte = tk.Frame(self.racine, bg=_CARTE, highlightbackground=_FILET, highlightthickness=1)
        carte.pack(fill="both", expand=True, padx=1, pady=1)
        # Accent VERTICAL d'un pixel : un repere linéaire, pas une lueur.
        # Deux segments verticaux, dore puis rose-violet : l'echo des deux arcs de l'ecran de
        # demarrage de l'application, en version lineaire.
        hauteur_accent = _HAUTEUR - 56
        tk.Frame(carte, bg=_DORE, width=2).place(x=0, y=28, height=hauteur_accent // 2)
        tk.Frame(carte, bg=_VIOLET, width=2).place(
            x=0, y=28 + hauteur_accent // 2, height=hauteur_accent - hauteur_accent // 2
        )

        titre_police = tkfont.Font(family="Segoe UI Semibold", size=15)
        corps = tkfont.Font(family="Segoe UI", size=10)
        etape_police = tkfont.Font(family="Segoe UI", size=11)
        mono = tkfont.Font(family="Consolas", size=9)

        entete = tk.Frame(carte, bg=_CARTE)
        entete.pack(fill="x", padx=(34, 28), pady=(30, 0))
        self._logo = self._charger_logo()
        if self._logo is not None:
            tk.Label(entete, image=self._logo, bg=_CARTE).pack(side="left", padx=(0, 14))
        bloc_titre = tk.Frame(entete, bg=_CARTE)
        bloc_titre.pack(side="left", anchor="w")
        tk.Label(bloc_titre, text="Autowin OS", bg=_CARTE, fg=_TEXTE, font=titre_police).pack(anchor="w")
        tk.Label(
            bloc_titre, text="mode développement", bg=_CARTE, fg=_DORE, font=corps
        ).pack(anchor="w")

        tk.Frame(carte, bg=_FILET, height=1).pack(fill="x", padx=(34, 28), pady=(22, 20))

        ligne_etape = tk.Frame(carte, bg=_CARTE)
        ligne_etape.pack(fill="x", padx=(34, 28))
        self.etiquette_etape = tk.Label(
            ligne_etape, text=self._libelle_courant, bg=_CARTE, fg=_TEXTE, font=etape_police
        )
        self.etiquette_etape.pack(side="left")
        self.etiquette_chrono = tk.Label(ligne_etape, text="0 s", bg=_CARTE, fg=_DORE, font=mono)
        self.etiquette_chrono.pack(side="right")

        # Un segment par etape REELLEMENT franchie, ajoute au fur et a mesure.
        #
        # La version precedente en dessinait un par etape CONNUE (huit) : trois restaient grises
        # jusqu'au bout, parce que le demarrage ne les traverse pas. L'utilisateur l'a dit —
        # « je sais pas a quoi servent les 3 dernieres barres » — et il avait raison : une case vide
        # promet une etape. Or le nombre d'etapes n'est PAS connu d'avance, l'application publie les
        # siennes (`[demarrage] … ms …`) au fil de son demarrage.
        self.segments = tk.Frame(carte, bg=_CARTE)
        self.segments.pack(fill="x", padx=(34, 28), pady=(14, 0))
        self._barres: list[tk.Frame] = []

        self.journal = tk.Label(
            self.racine, text="", bg=_CARTE, fg=_DORE, font=mono, justify="left", anchor="nw"
        )
        self.journal.place(x=35, y=196, width=_LARGEUR - 70, height=82)

        self.racine.after(200, self._battement)

    # -- fenetre ---------------------------------------------------------------------------------
    def _charger_logo(self) -> tk.PhotoImage | None:
        """Le VRAI logo du produit. Absent ou illisible : on s'en passe, on n'echoue pas pour une image."""
        chemin = _RACINE_PROJET / "resources" / "autowin-os-dev.png"
        try:
            image = tk.PhotoImage(file=str(chemin))
        except Exception:  # noqa: BLE001 - un logo manquant ne doit pas empecher le demarrage
            return None
        # `subsample` est entier : 1254 / 28 ≈ 44 donne ~28 px, la taille d'une icone de titre.
        facteur = max(1, image.width() // 28)
        return image.subsample(facteur, facteur)

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
            barre.pack(side="left", fill="x", expand=True, padx=(0, 3))
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
