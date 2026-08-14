"""Lecture des ETAPES de demarrage dans la sortie de `npm run dev`.

Module PUR : aucune fenetre, aucun processus, aucune horloge implicite. C'est la piece qu'on peut
eprouver sans lancer l'application — et c'est elle qui decide de ce que l'utilisateur VOIT.

Les motifs viennent d'un journal REEL (`.autowin-data/launch-dev.log`, 2026-08-12), pas d'une idee de
ce qu'electron-vite pourrait ecrire. Une etape inventee afficherait un vocabulaire qui n'arrive jamais,
et l'ecran resterait bloque sur « demarrage » pendant une minute.

CE QUE CET ECRAN CORRIGE. Le test `startup-splash.test.ts` porte la mesure : « 30 a 44 secondes
s'ecoulaient sans AUCUNE fenetre, puis l'interface apparaissait vers 70-80 s ». L'application a bouche
SA part du trou avec son propre ecran d'attente — mais il ne peut apparaitre qu'une fois Electron
demarre, donc APRES la compilation. Les premieres dizaines de secondes restaient noires, et on relance
l'application en croyant qu'elle n'a pas demarre.
"""

from __future__ import annotations

import re

# Ordre d'AFFICHAGE, qui est aussi l'ordre chronologique observe. Le rang sert a ne jamais faire
# reculer l'etape affichee : la sortie est entrelacee (vite, electron, brain ecrivent en meme temps),
# et un ecran qui repasserait de « interface prete » a « compilation » se lirait comme une regression.
ETAPES: tuple[tuple[str, str, str], ...] = (
    ("install", "Installation des dependances", r"\bnpm (?:install|ci)\b|added \d+ packages|idealTree"),
    ("vite", "Demarrage du serveur de developpement", r"vite v[\d.]|VITE v[\d.]|dev server running"),
    ("renderer", "Compilation de l'interface", r"modules transformed|built in \d|transforming \("),
    ("main", "Compilation du process principal", r"electron main process|preload .*rebuilt|build the main process"),
    ("electron", "Ouverture de la fenetre", r"restarting electron app|DevTools listening on"),
    ("brain", "Connexion au Brain", r"\[brain-launch\]|brain_server"),
    ("worktrees", "Inventaire des copies isolees", r"\[worktrees\]"),
    # Etapes que l'APPLICATION publie elle-meme, avec leur chrono : `[demarrage] 43900 ms corps du
    # module termine`. C'est la source la plus juste qui existe — elle nomme et mesure ses propres
    # phases. Le libelle affiche est celui de la ligne, pas un mot a nous.
    ("demarrage", "Demarrage de l'application", r"\[demarrage\]\s+\d+\s*ms"),
    # `pret` a ete RETIRE des motifs de log : il etait declenche par `[cdp] port …`, ecrit des la
    # 1re seconde, et l'ecran annoncait « Interface prete » pendant 15 s de chargement reel.
    # « Interface prete » ne vient plus que de la sonde de fenetre (`voir_fenetre`).
)

# Une ERREUR doit primer sur toute etape : c'est la seule chose qui explique un ecran qui ne bouge plus.
ERREURS = (
    # ANCRE sur le contexte de build. `ERROR:` seul matchait une ligne Chromium ordinaire
    # (« Network service crashed, restarting service »), un incident qui se remet tout seul, et
    # l'ecran annoncait « Compilation en ECHEC » sur un demarrage qui aboutissait.
    (r"Transform failed with|Unexpected \"<<|(?:esbuild|vite|rollup)[^\n]{0,40}ERROR", "Compilation en ECHEC"),
    # ROLLUP N'ECRIT PAS TOUJOURS « ERROR ». Un import qui ne resout pas sort sous la forme
    #   src/main/index.ts (278:9): "abortUpdateConflict" is not exported by "src/main/git-update.ts"
    # Aucun motif ci-dessus ne l'attrapait : le lanceur rendait alors 6 « bundle perime » — vrai mais
    # INERTE — la ou 7 « compilation en echec » existe justement pour ca. Vecu le 2026-08-13 : le
    # build etait casse par un export manquant, la ligne etait DANS le journal, l'alerte n'en disait
    # rien. Ces trois formes sont specifiques a la resolution de modules, insensibles au bruit Chromium.
    (r"is not exported by|Could not resolve \"|Rollup failed to resolve import", "Compilation en ECHEC"),
    (r"ERR_MODULE_NOT_FOUND|Cannot find module", "Module introuvable"),
    # `EADDRINUSE` SEUL : « [cdp] port 9224 - 9223 etait occupe » est un repli REUSSI.
    (r"EADDRINUSE", "Port deja utilise"),
    (r"npm ERR!", "npm a echoue"),
)

_RANGS = {cle: rang for rang, (cle, _, _) in enumerate(ETAPES)}
_LIBELLES = {cle: libelle for cle, libelle, _ in ETAPES}
_MOTIFS = tuple((cle, re.compile(motif, re.IGNORECASE)) for cle, _, motif in ETAPES)
_ERREURS = tuple((re.compile(motif, re.IGNORECASE), libelle) for motif, libelle in ERREURS)

# Les sequences ANSI de couleur polluent chaque ligne d'electron-vite ; sans nettoyage, les motifs
# ratent une ligne sur deux selon que la couleur tombe avant ou apres le mot cherche.
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def nettoyer(ligne: str) -> str:
    return _ANSI.sub("", ligne).strip()


# Les jalons `[demarrage]` de l'application sont des ETAPES FRANCHIES : « module principal evalue »
# dit ce qui vient de FINIR, pas ce qui se passe. Affiche tel quel, l'ecran annoncait du passe pendant
# que le travail continuait — l'utilisateur l'a dit : « il faut mettre ce que ca fait, pas ce que ca a
# fait avant ».
#
# On traduit donc chaque jalon en l'ACTIVITE QUI SUIT. Les six jalons sont ceux emis par
# `index.ts` (`jalonDemarrage`), dans l'ordre observe au journal, avec leurs durees mesurees le
# 2026-08-12 : c'est la ou passe le temps.
ACTIVITE_APRES: tuple[tuple[str, str], ...] = (
    # 1 ms -> 43 900 ms : le trou principal. Resoudre et evaluer la pile d'imports du process.
    ("module principal", "Chargement des modules du process principal"),
    # Nouveau jalon (2026-08-12) : separe l'execution des MODULES IMPORTES du corps de `index.ts`.
    # Sans lui, les 43,9 s restaient inattribuables entre les deux.
    ("imports du process principal", "Ouverture des dossiers de travail"),
    # Jalons de BISECTION (2026-08-12) : les 26,2 s du corps de `index.ts` etaient inattribuables.
    ("racine de donnees preparee", "Obtention du verrou d'instance"),
    ("verrou instance obtenu", "Construction du noyau applicatif"),
    ("noyau applicatif construit", "Demarrage des clients Brain"),
    ("clients brain crees", "Inventaire des appels chat interrompus"),
    ("appels chat recuperables", "Chargement des conversations et des taches"),
    ("stores conversations et taches", "Relecture du catalogue de modeles"),
    ("catalogue de modeles relu", "Enregistrement des canaux applicatifs"),
    # 43 900 -> 43 992 ms
    ("corps du module termine", "Attente de l'initialisation d'Electron"),
    # 43 992 -> 52 984 ms : neuf secondes avant meme de creer la fenetre.
    ("whenready", "Preparation de l'environnement applicatif"),
    # 52 984 -> 52 985 ms
    ("avant createwindow", "Construction de la fenetre"),
    # 52 985 -> 70 432 ms : chargement du bundle de l'interface.
    ("construction de la fenetre", "Chargement de l'interface"),
    # Terminal : la fenetre est visible, l'application prend le relais.
    ("ready-to-show", "Affichage de l'interface"),
    # DERNIER jalon d'`index.ts`, et il n'avait aucune traduction : il s'affichait donc tel quel,
    # « interface chargée » — au PASSE, exactement ce qu'on ne veut pas. Ce qui reste a faire apres
    # lui n'est plus du chargement : l'application devient utilisable et cet ecran s'efface.
    ("interface charge", "Passage de relais a l'application"),
)


def activite_apres(jalon: str) -> str:
    """Traduit un jalon FRANCHI en l'activite EN COURS. Jalon inconnu : on le rend tel quel plutot
    que d'inventer une activite qui n'aurait aucun rapport."""
    reduit = jalon.lower().replace("é", "e").replace("ê", "e").replace("à", "a")
    for motif, activite in ACTIVITE_APRES:
        if motif in reduit:
            return activite
    return jalon


_DEMARRAGE = re.compile(r"\[demarrage\]\s+(\d+)\s*ms\s+(.+)$", re.IGNORECASE)


def classer_ligne(ligne: str) -> tuple[str, str] | None:
    """Rend `(cle, libelle)` de l'etape reconnue, `('erreur', …)` pour un echec, `None` sinon."""
    propre = nettoyer(ligne)
    if not propre:
        return None
    for motif, libelle in _ERREURS:
        if motif.search(propre):
            return ("erreur", libelle)
    # L'application nomme et chronometre ses propres phases : on affiche SON libelle, pas le notre.
    interne = _DEMARRAGE.search(propre)
    if interne:
        # Le jalon dit ce qui est FINI ; on affiche ce qui COMMENCE.
        return ("demarrage", activite_apres(interne.group(2).strip()))
    for cle, motif in _MOTIFS:
        if motif.search(propre):
            return (cle, _LIBELLES[cle])
    return None


def progresse(courante: str | None, candidate: str) -> bool:
    """Vrai si `candidate` doit remplacer `courante`. Une erreur passe toujours ; une etape ne RECULE jamais."""
    if candidate == "erreur":
        return True
    if courante == "erreur":
        return False
    if courante is None:
        return True
    # `demarrage` se repete : chaque ligne de l'application est une phase NOUVELLE, dans l'ordre
    # qu'elle publie. La comparaison de rang la bloquerait des la deuxieme.
    if candidate == "demarrage":
        return True
    return _RANGS.get(candidate, -1) > _RANGS.get(courante, -1)


def libelle_duree(secondes: float) -> str:
    """« 4 s », « 1 min 12 s ». Une duree en millisecondes n'apprend rien a qui attend."""
    entier = int(secondes)
    if entier < 60:
        return f"{entier} s"
    return f"{entier // 60} min {entier % 60:02d} s"


def formater_identite(
    commit: str, branche: str, non_committes: int, retard: int | None = None
) -> str:
    """QUELLE version on lance, en une ligne, SANS chiffre ambigu.

    Sa plainte de depart : « ca lance une vieille version a chaque fois » sans jamais dire laquelle.
    Puis celle-ci, le 2026-08-13 : « le loading dit main +32 comites mais le bouton affiche +5 ».
    Les deux chiffres etaient JUSTES et disaient des choses differentes — 32 FICHIERS non committes
    ici, 5 COMMITS de retard dans l'app — mais tous deux s'affichaient « +N », donc ils se lisaient
    comme la meme grandeur et se contredisaient.

    Chaque nombre porte donc desormais son unite, en clair : « 32 fichiers modifies », « 5 commits de
    retard ». Un « +N » nu ne revient pas. Le retard figure ICI parce que c'est le chiffre ACTIONNABLE
    (ce qu'on n'a pas encore), la ou les fichiers modifies disent seulement que ce qui tourne n'est
    pas exactement le commit affiche. `retard=None` quand la comparaison n'a pas pu etre faite : une
    absence n'est pas un zero, et afficher « a jour » sans avoir compare serait un faux vert.

    Fonction pure : la lecture git (impure) se fait dans le splash et passe ici.
    """
    tete = commit.strip() or "sans commit"
    lieu = branche.strip() or "HEAD détaché"
    morceaux = [tete, lieu]
    if retard is None:
        morceaux.append("retard inconnu")
    elif retard > 0:
        morceaux.append(f"{retard} commit{'s' if retard > 1 else ''} de retard")
    else:
        morceaux.append("à jour")
    if non_committes > 0:
        morceaux.append(f"{non_committes} fichier{'s' if non_committes > 1 else ''} modifié{'s' if non_committes > 1 else ''}")
    else:
        morceaux.append("arbre propre")
    return " · ".join(morceaux)


class SuiviDemarrage:
    """Decide QUAND l'ecran d'attente doit se fermer. Pur, donc eprouvable sans fenetre.

    Le defaut qu'il corrige : la premiere version fermait l'ecran des que le bundle etait plus recent
    que les sources. Or il l'est DEJA au sortir d'un build — la condition etait donc vraie a la
    premiere ligne lue et l'ecran disparaissait aussitot, avant meme qu'Electron demarre.

    Deux questions distinctes, qui avaient ete confondues :
      - « le bundle est-il a jour ? » -> la garde anti-perime, qui decide s'il faut ALERTER ;
      - « l'application est-elle a l'ecran ? » -> la duree de vie de l'ecran d'attente.
    Seule la seconde doit le fermer.
    """

    # AUCUNE etape de log ne prouve qu'une fenetre est PEINTE, et s'y fier a coute cher : mesure du
    # 2026-08-12, `etape=pret` etait atteinte en 3 SECONDES et l'ecran se fermait sur du vide.
    # « restarting electron app » signifie qu'Electron REDEMARRE ; `[brain-launch]` et `[worktrees]`
    # sont des traces du process principal, ecrites avant que quoi que ce soit s'affiche.
    # La seule autorite acceptable est une FENETRE VISIBLE, constatee par le systeme
    # (`launch_dev.fenetre_app_visible`), et elle entre ici par `voir_fenetre`.

    def __init__(self) -> None:
        self.etape: str | None = None
        self.bundle_frais = False
        self.app_affichee = False
        self.erreur: str | None = None
        # La LIGNE fautive, gardee a part du libelle court. L'etiquette du splash doit rester courte ;
        # c'est l'ALERTE qui a besoin du detail. Vecu le 2026-08-13 : « bundle perime » sans cause,
        # alors que `"abortUpdateConflict" is not exported by …` etait dans le journal.
        self.erreur_ligne: str | None = None
        # Compte des lignes vues : c'est la PREUVE que le demarrage progresse encore. Un build long
        # est normal (mesure du depot : interface vers 70-80 s) ; un build MUET ne l'est pas.
        self.lignes_vues = 0

    def voir_ligne(self, ligne: str) -> tuple[str, str] | None:
        """Absorbe une ligne. Rend l'etape retenue, ou `None` si elle n'apprend rien."""
        if nettoyer(ligne):
            self.lignes_vues += 1
        classee = classer_ligne(ligne)
        if not classee:
            return None
        cle, libelle = classee
        if not progresse(self.etape, cle):
            return None
        self.etape = cle
        if cle == "erreur":
            self.erreur = libelle
            propre = nettoyer(ligne)
            self.erreur_ligne = propre if len(propre) <= 200 else f"{propre[:197]}…"
        return classee

    def voir_fenetre(self, visible: bool) -> None:
        """La SEULE chose qui prouve que l'application est la : une fenetre que le systeme montre."""
        if visible:
            self.app_affichee = True

    def voir_bundle(self, frais: bool) -> None:
        self.bundle_frais = frais

    def fermer(self) -> bool:
        """L'ecran se ferme quand l'application est affichee, ou sur erreur — jamais sur la fraicheur."""
        return self.app_affichee or self.erreur is not None

    def verdict(self, delai_depasse: bool) -> tuple[int, str | None]:
        """`(code, detail)`. 0 = demarre. 6 = bundle perime. 7 = compilation en echec."""
        if self.erreur:
            # Le detail porte la LIGNE quand on l'a : c'est ce que l'alerte affiche en tete, et la
            # seule chose qui dise a l'utilisateur QUOI reparer sans ouvrir le journal.
            return (7, f"{self.erreur} — {self.erreur_ligne}" if self.erreur_ligne else self.erreur)
        if self.app_affichee:
            # L'application est a l'ecran mais le bundle n'a pas ete reecrit : elle tourne donc sur
            # l'ancien. C'est exactement le « perime » qu'on cherche a rendre impossible.
            return (0, None) if self.bundle_frais else (6, None)
        if delai_depasse:
            return (6, None)
        return (0, None)

def decider_mise_a_jour(retard: int | None, non_committes: int) -> str:
    """FAUT-IL mettre a jour au lancement, et est-ce SUR de le faire ?

    Demande utilisateur : « ca devrait auto update en plus des le launcher », puis, apres l'avoir
    vecu : « la c debile jme tape le chargement il me dit 3 commits de retard et apres je lance
    l'app et je dois clicker sur mise a jour ».

    L'ARBRE SALE N'EST PLUS UN VETO, et c'est la correction. La version precedente refusait des
    qu'UN SEUL fichier etait modifie. Mesure le 2026-08-14 sur cet arbre partage (Claude + Codex +
    l'app en parallele) : `refus-arbre-sale (retard=3, non_committes=12)`, les 12 fichiers etant
    l'edition en cours d'une AUTRE session, sans aucun rapport avec les 3 commits a rapatrier. Le
    garde-fou ne protegeait donc rien : il rendait la mise a jour structurellement IMPOSSIBLE, ce que
    l'utilisateur a vu comme « il me dit 3 de retard et il ne fait rien ».

    La cicatrice du 2026-08-13 reste vraie mais ne s'applique PAS ici : c'est `git pull --autostash`
    qui avait efface un correctif non committe. `merge --ff-only` ne stashe JAMAIS et REFUSE de
    lui-meme quand les commits entrants toucheraient un fichier modifie localement — git est donc
    l'autorite, et elle est plus fine que ce veto. Un fichier modifie qui n'est pas dans les commits
    entrants n'a aucune raison de bloquer la mise a jour.

    Trois issues, toutes NOMMEES — un lanceur muet est ce qui a fait croire pendant des jours qu'on
    lançait la derniere version :
      `inconnu`   la comparaison n'a pas pu etre faite (pas de reference distante connue) ;
      `a-jour`    rien a rapatrier ;
      `appliquer` du retard : on TENTE le `--ff-only`, et git refuse tout seul s'il y a conflit.
    Le refus n'est plus DECIDE ici : il est CONSTATE apres coup, sur le code de retour de git.
    """
    if retard is None:
        return "inconnu"
    if retard <= 0:
        return "a-jour"
    return "appliquer"


def libelle_mise_a_jour(decision: str, retard: int | None, non_committes: int) -> str:
    """Ce que l'ecran d'attente AFFICHE de cette decision. Chaque nombre garde son unite."""
    if decision == "inconnu":
        return "retard inconnu : aucune référence distante lisible"
    if decision == "a-jour":
        return "déjà à jour"
    commits = f"{retard} commit{'s' if (retard or 0) > 1 else ''}"
    if decision == "appliquer":
        if non_committes > 0:
            # Le travail en cours est NOMME sans etre presente comme un blocage : `--ff-only` le
            # preserve, et si un conflit existait git refuserait de lui-meme.
            fichiers = (
                f"{non_committes} fichier{'s' if non_committes > 1 else ''} "
                f"modifié{'s' if non_committes > 1 else ''} préservé{'s' if non_committes > 1 else ''}"
            )
            return f"mise à jour : {commits} à rapatrier, {fichiers}"
        return f"mise à jour : {commits} à rapatrier"
    # Plus aucune decision ne mene ici : le refus n'est plus DECIDE en amont, il est constate sur le
    # code de retour de git. Ce filet reste pour ne pas rendre une chaine vide si une issue naissait.
    return f"{commits} de retard : état non conclu"
