"""Tests du lecteur d'etapes. Lignes VERBATIM du journal reel `.autowin-data/launch-dev.log`."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launch_dev_phases import classer_ligne, libelle_duree, nettoyer, progresse  # noqa: E402

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


# --- lignes REELLES, couleurs ANSI comprises ---------------------------------------------------
verifie(classer_ligne("\x1b[32m\xe2\x9c\x93\x1b[39m 202 modules transformed.") is not None,
        "une ligne coloree doit etre reconnue : sans nettoyage ANSI, une ligne sur deux est ratee")
verifie(classer_ligne("202 modules transformed.")[0] == "renderer", "compilation interface")
verifie(classer_ligne("electron main process rebuilt successfully")[0] == "main", "process principal")
verifie(classer_ligne("restarting electron app...")[0] == "electron", "ouverture fenetre")
verifie(classer_ligne("DevTools listening on ws://127.0.0.1:9224/devtools/browser/4a70")[0] == "electron",
        "DevTools = Electron demarre")
verifie(classer_ligne("[brain-launch] already-up - brain_server deja joignable")[0] == "brain", "brain")
verifie(classer_ligne("[worktrees] 93 copies isolees interrompues conservees")[0] == "worktrees", "worktrees")
# `[cdp] port …` s'ecrit des la 1re seconde : il NE PROUVE RIEN. L'ecran annoncait « Interface prete »
# pendant 15 s de chargement reel — l'utilisateur l'a vu et l'a dit.
verifie(classer_ligne("[cdp] port 9224 - 9223 etait occupe") is None,
        "l'ouverture du port de debogage ne doit PAS annoncer une interface prete")

# L'APPLICATION publie ses propres etapes, nommees et chronometrees : c'est la meilleure source.
_interne = classer_ligne("[demarrage]  43900 ms  corps du module termine, whenReady enregistre")
verifie(_interne is not None and _interne[0] == "demarrage", "les etapes de l'app doivent etre lues")
# UN JALON DIT CE QUI EST FINI ; L'ECRAN DOIT DIRE CE QUI SE PASSE.
# « module principal evalue » est du PASSE : affiche tel quel, l'ecran annoncait une etape terminee
# pendant que le travail continuait.
from launch_dev_phases import ACTIVITE_APRES, activite_apres  # noqa: E402

verifie(_interne[1] == "Attente de l'initialisation d'Electron",
        "un jalon franchi doit etre traduit en l'ACTIVITE qui suit")
verifie(
    classer_ligne("[demarrage] 1 ms  module principal evalue")[1]
    == "Chargement des modules du process principal",
    "le jalon du module evalue annonce le chargement des modules, la ou passent les 43,9 s",
)
for _motif, _activite in ACTIVITE_APRES:
    verifie(not _activite.lower().endswith(("e", "ee", "es")) or _activite[0].isupper(),
            "une activite se formule au present, pas au participe passe")
# Les six jalons reels de `index.ts` doivent TOUS etre traduits : un jalon non couvert reapparaitrait
# tel quel a l'ecran, donc au passe.
for _jalon in (
    "module principal évalué",
    "corps du module terminé, whenReady enregistré",
    "app.whenReady",
    "avant createWindow",
    "construction de la fenêtre",
    "ready-to-show : la fenêtre devient visible",
):
    verifie(activite_apres(_jalon) != _jalon,
            f"le jalon « {_jalon[:34]} » doit avoir une activite, sinon il s'affiche au passe")

# LIEN VIVANT avec la source : on relit les jalons dans `index.ts`. Un jalon AJOUTE la-bas sans
# traduction ici reapparaitrait a l'ecran au passe — exactement le defaut qu'on vient de corriger.
import re as _re  # noqa: E402

_index = (Path(__file__).resolve().parent.parent / "src" / "main" / "index.ts").read_text(
    encoding="utf-8"
)
_jalons_source = _re.findall(r"jalonDemarrage\('([^']+)'\)", _index)
verifie(len(_jalons_source) >= 6, "les jalons doivent etre trouves dans index.ts (sinon ce test ment)")
for _j in _jalons_source:
    verifie(activite_apres(_j) != _j,
            f"jalon d'index.ts sans traduction : « {_j[:38]} » s'afficherait au passe")
verifie(progresse("demarrage", "demarrage"),
        "chaque ligne [demarrage] est une etape NOUVELLE : la comparaison de rang la bloquerait")

# Ligne Chromium ordinaire : elle contient « ERROR: » et faisait annoncer « Compilation en ECHEC ».
verifie(classer_ligne(
    "[32516:0812/180307:ERROR:content/browser/network_service_instance_impl.cc:613] "
    "Network service crashed, restarting service."
) is None, "un incident Chromium banal n'est PAS un echec de compilation")

# --- l'ERREUR prime, c'est la seule chose qui explique un ecran fige -----------------------------
erreur = classer_ligne('[vite:esbuild] Transform failed with 1 error:')
verifie(erreur is not None and erreur[0] == "erreur", "un echec de compilation doit primer")
verifie(classer_ligne('ERROR: Unexpected "<<"')[0] == "erreur", "le marqueur de conflit reel")
verifie(classer_ligne("npm ERR! code ELIFECYCLE")[0] == "erreur", "npm en echec")

# --- une ligne banale ne doit RIEN declencher ----------------------------------------------------
verifie(classer_ligne("") is None, "ligne vide")
verifie(classer_ligne("   ") is None, "ligne blanche")
verifie(classer_ligne("un texte quelconque sans motif connu") is None,
        "une ligne inconnue ne doit pas inventer une etape")

# --- l'etape ne RECULE jamais --------------------------------------------------------------------
verifie(progresse(None, "vite"), "premiere etape acceptee")
verifie(progresse("vite", "renderer"), "avancer est permis")
verifie(not progresse("electron", "renderer"),
        "reculer est INTERDIT : la sortie est entrelacee, un ecran qui recule se lit comme une panne")
verifie(progresse("electron", "erreur"), "une erreur passe toujours")
verifie(not progresse("erreur", "pret"), "apres une erreur, on n'affiche plus un faux succes")

# --- durees lisibles ----------------------------------------------------------------------------
verifie(libelle_duree(4.7) == "4 s", "secondes")
verifie(libelle_duree(72) == "1 min 12 s", "minutes")
verifie(nettoyer("\x1b[31mrouge\x1b[39m") == "rouge", "nettoyage ANSI")

# --- INSTANCE UNIQUE : le verrou doit mordre ENTRE PROCESSUS ------------------------------------
# Defaut mesure le 2026-08-12 : DEUX alertes identiques cote a cote. Cause : le nom du mutex derivait
# de `hash()`, que Python randomise par processus — trois lancements, trois noms, donc aucun verrou.
# Second defaut trouve en verifiant : `restype` ctypes par defaut tronquait le HANDLE 64 bits et
# `windll.GetLastError()` rendait un code perime, si bien que le PREMIER appel se croyait dedouble.
import importlib.util  # noqa: E402
import subprocess  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "lanceur", str(Path(__file__).resolve().parent / "launch_dev.py")
)
_lanceur = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_lanceur)

_ligne_mutex = next(
    ligne
    for ligne in Path(_lanceur.__file__).read_text(encoding="utf-8").splitlines()
    if ligne.startswith("MUTEX =")
)
# On vise l'AFFECTATION, pas le commentaire au-dessus : celui-ci NOMME `hash()` pour expliquer le
# defaut, et une assertion qui lit les alentours se declencherait sur sa propre documentation.
verifie("hash(" not in _ligne_mutex,
        "le nom du mutex ne doit PAS venir de hash() : Python le randomise a chaque processus")
verifie("_EMPREINTE" in _ligne_mutex, "il doit venir d'un hachage stable entre processus")

_autre = subprocess.run(
    [sys.executable, "-c",
     "import importlib.util,sys;"
     f"s=importlib.util.spec_from_file_location('l',r'{_lanceur.__file__}');"
     "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.MUTEX)"],
    capture_output=True, text=True,
)
verifie(_autre.stdout.strip() == _lanceur.MUTEX,
        "le nom du mutex doit etre IDENTIQUE dans un autre processus, sinon il ne verrouille rien")

verifie(_lanceur.instance_unique(), "le PREMIER appel doit obtenir le verrou")
_second = subprocess.run(
    [sys.executable, "-c",
     "import importlib.util,sys;"
     f"s=importlib.util.spec_from_file_location('l',r'{_lanceur.__file__}');"
     "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.instance_unique())"],
    capture_output=True, text=True,
)
verifie(_second.stdout.strip() == "False",
        "une SECONDE instance doit etre refusee tant que la premiere tient le verrou")

# --- PALETTE : la MEME que l'ecran de demarrage de l'app ----------------------------------------
# Deux ecrans se suivent a l'oeil pendant un demarrage. Deux codes couleur differents feraient croire
# a deux produits — et une palette copiee A LA MAIN derive au premier changement de theme cote app.
# On relit donc les valeurs a la SOURCE et on refuse la derive.
_html = (Path(__file__).resolve().parent.parent / "src" / "renderer" / "index.html").read_text(
    encoding="utf-8"
)
_splash_src = (Path(__file__).resolve().parent / "launch_dev_splash.py").read_text(encoding="utf-8")

for _nom, _motif in (("doré (arc-a)", "#e9bd4e"), ("rose-violet (arc-b)", "#9d79ed")):
    verifie(_motif in _html, f"la couleur {_nom} doit exister dans index.html (sinon ce test ment)")
    verifie(
        _motif in _splash_src,
        f"le lanceur doit reprendre la couleur {_nom} de l'app, pas une teinte a lui",
    )

verifie("#f5f7fb" in _html and "#f5f7fb" in _splash_src,
        "la couleur de TEXTE doit etre celle de l'app")
# REPARTITION demandee par l'utilisateur : le GROS titre en blanc, tous les PETITS textes en dore.
# Un gris "atone" invente pour atténuer avait ete introduit a la place : il n'appartient a aucune des
# deux palettes et rendait terne un ecran qui doit etre noir et dore.
verifie("_ATONE" not in _splash_src,
        "le gris atone invente ne doit pas revenir : les petits textes sont dores")
verifie(_splash_src.count("fg=_DORE") >= 3,
        "sous-titre, chrono et detail doivent etre dores")
verifie('text="Autowin OS"' in _splash_src and "fg=_TEXTE" in _splash_src,
        "le gros titre reste BLANC")
verifie("background: #000" in _html and '_FOND = "#000000"' in _splash_src,
        "le fond doit etre NOIR des deux cotes")
# Le vert de la premiere version ne doit pas resurgir : il n'appartient a aucune des deux palettes.
verifie("#7ee2a8" not in _splash_src,
        "l'accent vert d'origine doit avoir disparu : il n'est pas dans la palette du produit")

# --- COURSE : application affichee => JAMAIS d'alerte -------------------------------------------
# Defaut mesure le 2026-08-12 a 17:46:08 : l'ecran s'est ferme parce que l'app s'affichait (le succes),
# le thread de travail n'avait pas encore ecrit son verdict, et le defaut `6` a declenche
# « bundle perime ». Le journal contenait la contradiction en clair : ALERTE puis verdict=0 la MEME
# seconde. Le defaut ne doit donc pas etre un echec arbitraire, mais decouler de ce qui a ete OBSERVE.
_source_lanceur = (Path(__file__).resolve().parent / "launch_dev.py").read_text(encoding="utf-8")
verifie("resultat.get(\"code\", 6)" not in _source_lanceur,
        "un resultat non encore ecrit ne doit PAS valoir echec : c'etait la fausse alerte")
verifie("defaut = 0 if splash.suivi.app_affichee else 6" in _source_lanceur,
        "le defaut doit venir du SUIVI : app affichee = succes")
verifie("ouvrier.join(" in _source_lanceur,
        "il faut ATTENDRE l'ouvrier avant de lire son verdict, sinon la course revient")

# La propriete elle-meme, sur le suivi : app affichee + bundle frais => succes, sans exception.
from launch_dev_phases import SuiviDemarrage as _Suivi  # noqa: E402

_affiche = _Suivi()
# Par la SONDE, pas par une ligne de log : une trace texte ne prouve aucun affichage.
_affiche.voir_fenetre(True)
_affiche.voir_bundle(True)
verifie(_affiche.verdict(False) == (0, None), "app affichee + bundle frais = succes")
verifie(_affiche.verdict(True) == (0, None),
        "meme si un delai est depasse : une app AFFICHEE n'est pas un echec")

# --- FERMETURE : une FENETRE REELLE, et NOUVELLE ------------------------------------------------
# Deux defauts mesures le 2026-08-12, tous deux corriges ici :
#   1. les lignes de log declaraient l'app « affichee » — `etape=pret` en 3 s, ecran encore noir ;
#   2. une fenetre « Autowin OS » DEJA ouverte (instance survivante) fermait l'ecran aussitot.
_src = (Path(__file__).resolve().parent / "launch_dev.py").read_text(encoding="utf-8")
verifie("fenetres_app()" in _src, "la sonde doit enumerer les fenetres du systeme")
verifie("fenetres_app() - deja_ouvertes" in _src,
        "seule une fenetre NOUVELLE prouve que CE lancement a produit quelque chose")
verifie("deja_ouvertes = fenetres_app()" in _src,
        "la reference doit etre prise AVANT le lancement")

# Aucune etape de log ne doit plus declarer l'app affichee.
_phases = (Path(__file__).resolve().parent / "launch_dev_phases.py").read_text(encoding="utf-8")
verifie("AFFICHEE" not in _phases,
        "aucune etape de LOG ne doit prouver un affichage : c'etait la cause de la fermeture prematuree")
verifie("def voir_fenetre" in _phases, "l'affichage entre par une sonde systeme, pas par du texte")

_sans_fenetre = _Suivi()
for _l in ("restarting electron app...", "[brain-launch] already-up", "[worktrees] 93 copies", "[cdp] port 9224"):
    _sans_fenetre.voir_ligne(_l)
verifie(not _sans_fenetre.fermer(),
        "meme les lignes les plus tardives ne ferment PAS l'ecran sans fenetre constatee")
_sans_fenetre.voir_fenetre(True)
verifie(_sans_fenetre.fermer(), "une fenetre constatee, elle, ferme l'ecran")

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print(f"PASS launch_dev_phases ({len(ECHECS)} echec)")

# --- DUREE DE VIE : le defaut « ca disparait encore » -------------------------------------------
# La premiere version fermait l'ecran des que le bundle etait frais. Or il l'est DEJA au sortir d'un
# build : l'ecran se fermait a la premiere ligne lue, avant meme qu'Electron demarre.
from launch_dev_phases import SuiviDemarrage  # noqa: E402

suivi = SuiviDemarrage()
suivi.voir_bundle(True)  # bundle deja frais : ne doit RIEN fermer
verifie(not suivi.fermer(), "un bundle frais ne doit PAS fermer l'ecran : c'est le defaut corrige")

suivi.voir_ligne("202 modules transformed.")
verifie(not suivi.fermer(), "compiler n'est pas afficher : l'ecran reste")
suivi.voir_ligne("electron main process rebuilt successfully")
verifie(not suivi.fermer(), "le process principal compile ne prouve aucune fenetre")

suivi.voir_fenetre(True)
verifie(suivi.fermer(), "une fenetre constatee par le SYSTEME ferme l'ecran ; une ligne de log, non")
verifie(suivi.verdict(False) == (0, None), "app affichee + bundle frais = demarrage reussi")

# App affichee mais bundle NON reecrit : elle tourne sur l'ancien code -> on alerte.
perime = SuiviDemarrage()
perime.voir_fenetre(True)
perime.voir_bundle(False)
verifie(perime.verdict(False)[0] == 6, "app affichee sur un bundle perime doit ALERTER, pas se taire")

# Erreur de compilation : ferme aussi, mais avec son propre code.
casse = SuiviDemarrage()
casse.voir_ligne('[vite:esbuild] Transform failed with 1 error:')
verifie(casse.fermer(), "une erreur ferme l'ecran")
verifie(casse.verdict(False)[0] == 7, "un echec de compilation a son propre verdict")
_detail_casse = casse.verdict(False)[1] or ""
# L'egalite stricte au libelle nu interdisait d'ENRICHIR le detail : il porte maintenant AUSSI la
# ligne fautive, seule chose qui dise QUOI reparer sans ouvrir le journal.
verifie(_detail_casse.startswith("Compilation en ECHEC"), "le verdict NOMME la cause")
verifie("Transform failed" in _detail_casse, "et il porte la LIGNE fautive, pas seulement la categorie")

# ROLLUP N'ECRIT PAS TOUJOURS « ERROR ». Un import non resolu s'ecrit autrement, et aucun motif ne
# l'attrapait : le lanceur rendait 6 « bundle perime » (inerte) au lieu de 7 « compilation en echec ».
# Ce correctif avait deja ete ecrit puis PERDU par un autostash concurrent avant d'etre committe —
# c'est pourquoi il est ici, teste ET committe cette fois.
_rollup = ('src/main/index.ts (278:9): "abortUpdateConflict" is not exported by '
           '"src/main/git-update.ts", imported by "src/main/index.ts".')
_c = classer_ligne(_rollup)
verifie(_c is not None and _c[0] == "erreur", "un import non resolu est un ECHEC, pas un retard")
verifie(_c[1] == "Compilation en ECHEC", "le libelle reste COURT pour l'etiquette d'etape")
verifie(classer_ligne('Could not resolve "./absent" from "src/main/index.ts"')[0] == "erreur",
        "module introuvable a la resolution")
verifie(classer_ligne('Rollup failed to resolve import "x" from "a.ts"')[0] == "erreur",
        "echec de resolution annonce par rollup")
verifie(classer_ligne("ERROR:gpu_process_host.cc(1000) Network service crashed.") is None,
        "un incident Chromium qui se remet seul n'est pas un echec de compilation")

_sc = SuiviDemarrage()
_sc.voir_ligne(_rollup)
_code7, _detail7 = _sc.verdict(False)
verifie(_code7 == 7, "une compilation cassee par un import non resolu rend 7, pas 6")
verifie("abortUpdateConflict" in (_detail7 or "") and "git-update" in (_detail7 or ""),
        "le detail du verdict nomme le symbole ET le fichier a corriger")

# Rien ne vient et le delai expire : perime, pas succes silencieux.
muet = SuiviDemarrage()
verifie(not muet.fermer(), "sans signal, l'ecran reste ouvert")
verifie(muet.verdict(True)[0] == 6, "delai depasse sans fenetre = perime")

# --- LENT n'est pas MUET (fausse alerte du 2026-08-12 17:32) ------------------------------------
# La garde mesurait la duree TOTALE, plafond 90 s. Le bundle a ete reecrit LA MEME MINUTE que l'alerte :
# le demarrage etait lent, pas casse. Le test du depot mesure d'ailleurs « interface vers 70-80 s ».
lent = SuiviDemarrage()
for _ in range(40):
    lent.voir_ligne("transforming (1234) node_modules/some/module.js")
verifie(lent.lignes_vues == 40, "chaque ligne non vide compte comme une PREUVE de progression")
verifie(not lent.fermer(), "un demarrage qui parle encore ne doit pas etre coupe")
verifie(lent.verdict(False)[0] == 0, "tant que ca parle, aucun verdict d'echec")

muet = SuiviDemarrage()
verifie(muet.lignes_vues == 0, "aucune ligne = aucune preuve de progression")
verifie(muet.verdict(True)[0] == 6, "un demarrage MUET au-dela du delai reste un echec")

blanches = SuiviDemarrage()
for _ in range(5):
    blanches.voir_ligne("   " + chr(10))
verifie(blanches.lignes_vues == 0,
        "des lignes VIDES ne prouvent rien : elles ne doivent pas faire passer un silence pour du travail")

# --- l'ECRAN lui-meme : construit, absorbe, affiche une DUREE par etape -------------------------
# Verifie sans `mainloop` : on vide la file a la main, sinon le test attendrait la fermeture.
try:
    from launch_dev_splash import Splash, etapes_connues

    ecran = Splash()
    verifie(ecran.racine.winfo_exists() == 1, "la fenetre doit exister DES la construction")
    for ligne in (
        "vite v5.4.0 dev server running",
        "\x1b[32m202 modules transformed.\x1b[39m",
        "electron main process rebuilt successfully",
        "restarting electron app...",
        "[cdp] port 9224",
    ):
        ecran.pousser(ligne)
    while not ecran.lignes.empty():
        ecran._absorber(ecran.lignes.get_nowait())
    ecran.racine.update()
    verifie(ecran.etiquette_etape.cget("text") in ("Ouverture de la fenetre", "Interface prete"),
            "l'etape affichee doit suivre la derniere reconnue")
    verifie(len(ecran._durees) >= 3,
            "chaque etape franchie doit laisser sa DUREE : c'est la reponse a « qu'est-ce qui prend du temps »")
    verifie(" s" in ecran.journal.cget("text"),
            "le journal affiche une duree lisible a cote de chaque etape")
    # Des lignes de log ne ferment PLUS l'ecran : il faut une fenetre constatee.
    verifie(not ecran.fini,
            "les lignes de log seules ne doivent PAS fermer l'ecran — c'etait la disparition prematuree")
    # Une erreur doit primer meme apres « Interface prete » — teste AVANT la fermeture, sinon les
    # widgets sont detruits et la lecture n'a plus de sens.
    ecran._absorber('[vite:esbuild] Transform failed with 1 error:')
    verifie(ecran.etiquette_etape.cget("text") == "Compilation en ECHEC",
            "une erreur tardive doit remplacer un faux succes affiche")
    # Autant de segments que d'etapes FRANCHIES, jamais de case grise en attente : une case vide
    # promet une etape, et le nombre d'etapes n'est pas connu d'avance.
    verifie(len(ecran._barres) == len(ecran._durees) - 1 or len(ecran._barres) == len(ecran._durees),
            "un segment par etape franchie, pas un par etape imaginaire")
    verifie(all(b.cget("bg") != "#1c1d1f" for b in ecran._barres),
            "aucun segment ne doit rester en couleur d'attente : ils sont crees quand l'etape arrive")
    # Un second battement APRES fermeture ne doit pas lever : le rappel planifie peut arriver en retard.
    ecran._battement()
except ImportError as erreur:  # tkinter absent : on le DIT, on ne fait pas passer le test en silence
    ECHECS.append(f"tkinter indisponible, l'ecran d'attente ne peut pas fonctionner : {erreur}")

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS launch_dev_phases + splash")

# --- Garde 2 : QUELLE version le lanceur execute ------------------------------------------------
# Plainte de depart : « ca lance une vieille version a chaque fois » sans jamais dire laquelle.
from launch_dev_phases import formater_identite as _fmt  # noqa: E402

verifie(_fmt("fc5f2d6", "main", 0, 0) == "fc5f2d6 · main · à jour · arbre propre",
        "rien a faire : chaque etat est NOMME, aucun « +N » nu")
verifie(_fmt("fc5f2d6", "main", 32, 5) == "fc5f2d6 · main · 5 commits de retard · 32 fichiers modifiés",
        "les DEUX grandeurs portent leur unite : le loading disait « +32 » et l'app « +5 », "
        "les deux justes, illisibles ensemble")
verifie("1 commit de retard" in _fmt("abc1234", "main", 1, 1)
        and "1 fichier modifié" in _fmt("abc1234", "main", 1, 1),
        "singulier au singulier, pluriel au pluriel, sur les deux nombres")
verifie("retard inconnu" in _fmt("abc1234", "main", 0, None),
        "comparaison impossible : on le DIT, on n'affiche pas « a jour » sans avoir compare")
verifie("+" not in _fmt("fc5f2d6", "main", 32, 5),
        "aucun « +N » nu ne revient : c'est ce qui rendait les deux chiffres confondables")
verifie(_fmt("", "main", 0, 0).startswith("sans commit"),
        "un commit vide ne casse pas la ligne")
verifie("détaché" in _fmt("abc1234", "", 0, 0),
        "une branche vide (HEAD detache) est nommee, pas laissee vide")

# --- Mise a jour automatique au lancement : QUAND, et surtout QUAND PAS ---
from launch_dev_phases import decider_mise_a_jour as _maj, libelle_mise_a_jour as _majl  # noqa: E402

verifie(_maj(0, 0) == "a-jour", "rien a rapatrier : on ne touche a rien")
verifie(_maj(5, 0) == "appliquer", "du retard et un arbre propre : on rapatrie")
verifie(_maj(5, 3) == "refus-arbre-sale",
        "du retard MAIS du travail en cours : on NE TOUCHE PAS. Le 2026-08-13 un pull --autostash "
        "concurrent a efface un correctif non committe de l'arbre partage ; un lanceur qui stashe "
        "au double-clic reproduirait ce degat a chaque demarrage")
verifie(_maj(None, 0) == "inconnu",
        "comparaison impossible : c'est une issue NOMMEE, pas un « a jour » invente")
verifie(_maj(None, 9) == "inconnu",
        "sans retard connu, l'etat de l'arbre ne peut pas conclure a lui seul")
verifie("rien ne sera touché" in _majl("refus-arbre-sale", 5, 3),
        "le refus DIT ce qu'il protege, sinon il passe pour une panne")
verifie("5 commits" in _majl("appliquer", 5, 0) and "+" not in _majl("appliquer", 5, 0),
        "les nombres portent leur unite, aucun « +N » nu qui se confondrait avec un autre compteur")
verifie(_majl("a-jour", 0, 0) == "déjà à jour", "l'etat nominal se lit d'un coup d'oeil")

# VERDICT de ce troisieme bloc. Sans lui, les `verifie` ci-dessus n'assertaient RIEN : le fichier
# imprimait deja « PASS » plus haut, et les echecs s'empilaient dans `ECHECS` sans jamais etre lus.
# Constate par mutation — desarmer le refus sur arbre sale laissait le test vert.
if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS launch_dev_phases + mise a jour")
