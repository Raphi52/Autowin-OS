#!/usr/bin/env python3
"""Identite d'entreprise du Brain, lue en option -- jamais ecrite dans le code.

Meme contrat que `src/main/identite-entreprise.ts` cote application. Le code ne connait que des
valeurs NEUTRES ; un profil `entreprise/<nom>/identite.json` leur ajoute ce que les postes de cette
entreprise ont deja sur disque : nom de service signe dans chaque echange, dossier d'installation,
anciens noms de variables lus en secours. Sans profil (version publique), tout reste neutre.

Ordre de lecture :
1. `AUTOWIN_IDENTITE_ENTREPRISE` (JSON), publie par l'application pour tous les processus qu'elle
   lance -- la valeur `{}` force l'identite neutre ;
2. `identite.json` a cote du dossier `tooling/` : la copie installee par `install.ps1`
   (`%LOCALAPPDATA%\\<dossier>\\identite.json`) ;
3. `entreprise/<nom>/identite.json` a la racine du depot, premier nom par ordre alphabetique.
"""
import json
import os
import re
from pathlib import Path

VARIABLE = "AUTOWIN_IDENTITE_ENTREPRISE"
NEUTRE = {
    "service": "autowin-brain",
    "dossierLocal": "AutowinBrain",
    "dossierMaison": ".autowin-brain",
    "variables": {},
}
_SERVICE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
# Un nom fait seulement de points (`.`, `..`) viserait le dossier courant ou parent : refuse.
_DOSSIER = re.compile(r"^(?!\.+$)[A-Za-z0-9._-]{1,64}$")
_VARIABLE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
_CACHE: tuple = (None, None)
_FICHIER = None


def _profil_brut() -> str:
    global _FICHIER
    publie = os.environ.get(VARIABLE, "").strip()
    if publie:
        return publie
    if _FICHIER is None:
        _FICHIER = _profil_du_disque()
    return _FICHIER


def _profil_du_disque() -> str:
    ici = Path(__file__).resolve().parent
    candidats = [ici.parent / "identite.json"]
    dossier = ici.parent.parent / "entreprise"
    try:
        candidats += [d / "identite.json" for d in sorted(dossier.iterdir(), key=lambda d: d.name) if d.is_dir()]
    except OSError:
        pass
    for chemin in candidats:
        try:
            texte = chemin.read_text(encoding="utf-8-sig")
            json.loads(texte)
            return texte
        except (OSError, ValueError):
            continue
    return ""


def _normaliser(brut: str) -> dict:
    try:
        profil = json.loads(brut) if brut else {}
    except ValueError:
        profil = {}
    brain = profil.get("brain") if isinstance(profil, dict) else None
    brain = brain if isinstance(brain, dict) else {}

    def champ(nom: str, motif) -> str:
        valeur = brain.get(nom)
        return valeur if isinstance(valeur, str) and motif.match(valeur) else NEUTRE[nom]

    variables = {}
    brutes = brain.get("variables")
    if isinstance(brutes, dict):
        for neutre, ancien in brutes.items():
            if (isinstance(neutre, str) and isinstance(ancien, str) and _VARIABLE.match(neutre)
                    and _VARIABLE.match(ancien) and neutre != ancien):
                variables[neutre] = ancien
    return {
        "service": champ("service", _SERVICE),
        "dossierLocal": champ("dossierLocal", _DOSSIER),
        "dossierMaison": champ("dossierMaison", _DOSSIER),
        "variables": variables,
    }


_CLE_METIER = re.compile(r"^[a-z][a-z0-9]{0,31}$")
_MOT_METIER = re.compile(r"^[a-z0-9][a-z0-9 ._-]{0,63}$")
_NOM_FICHIER = re.compile(r"^(?!\.+$)[A-Za-z0-9._-]{1,64}$")
_NOM_MODULE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_LIBELLE = re.compile(r"^[^\r\n]{1,80}$")


def _normaliser_metier(brut: str):
    """Domaine metier du profil (conv-916), ou None : sans cle ni libelle valides, aucun domaine.

    Meme contrat que `normaliserMetier` de `src/main/identite-entreprise.ts`. Le Brain d'une
    entreprise range son metier a part : scope `<cle>`, theme `theme/<cle>`, carte
    `knowledge/_maps/<cle>.md`, documentation source sous `knowledge/domain/<documentation>/`.
    """
    try:
        profil = json.loads(brut) if brut else {}
    except ValueError:
        return None
    metier = profil.get("metier") if isinstance(profil, dict) else None
    if not isinstance(metier, dict):
        return None
    cle, libelle = metier.get("cle"), metier.get("libelle")
    if not (isinstance(cle, str) and _CLE_METIER.match(cle) and isinstance(libelle, str) and _LIBELLE.match(libelle)):
        return None
    documentation = metier.get("documentation")
    fichiers = metier.get("fichiersDocumentation")
    couverture = metier.get("couverture")
    return {
        "cle": cle,
        "libelle": libelle,
        "documentation": documentation if isinstance(documentation, str) and _MOT_METIER.match(documentation) else None,
        "fichiersDocumentation": tuple(
            nom for nom in (fichiers if isinstance(fichiers, list) else [])
            if isinstance(nom, str) and _NOM_FICHIER.match(nom)
        ),
        "couverture": couverture if isinstance(couverture, str) and _NOM_MODULE.match(couverture) else None,
    }


def identite() -> dict:
    """Identite du Brain en vigueur (relue si la variable publiee change)."""
    global _CACHE
    brut = _profil_brut()
    if _CACHE[0] != brut:
        _CACHE = (brut, {**_normaliser(brut), "metier": _normaliser_metier(brut)})
    return _CACHE[1]


def metier():
    """Domaine metier de l'entreprise, ou None (version publique, tests en identite neutre)."""
    return identite()["metier"]


def module_metier(nom: str):
    """Module Python propre a l'entreprise (ex. son registre de couverture), ou None s'il manque.

    Installe, il est copie a cote du tooling (`install.ps1`). Dans le depot, il vit sous
    `entreprise/<nom>/brain/tooling/`, absent de la version publique : ce dossier n'est ajoute au
    chemin d'import que s'il existe. Le code generique ne l'importe jamais par son nom.
    """
    import importlib
    import sys

    racine = Path(__file__).resolve().parent.parent.parent / "entreprise"
    try:
        for dossier in sorted(racine.iterdir(), key=lambda d: d.name):
            outils = dossier / "brain" / "tooling"
            if outils.is_dir() and str(outils) not in sys.path:
                sys.path.append(str(outils))
    except OSError:
        pass
    try:
        return importlib.import_module(nom)
    except ModuleNotFoundError as erreur:
        # Seul le module ABSENT rend None : une erreur a l'interieur du module doit remonter.
        if erreur.name == nom:
            return None
        raise


def service() -> str:
    """Nom de service signe dans chaque echange, et prefixe des schemas de notes."""
    return identite()["service"]


def schema(suffixe: str) -> str:
    """Schema `<service>/<suffixe>` : les notes deja au Brain partage portent celui du profil."""
    return f"{service()}/{suffixe}"


def dossier_local() -> str:
    return identite()["dossierLocal"]


def dossier_maison() -> str:
    return identite()["dossierMaison"]


def nom_historique(neutre: str):
    return identite()["variables"].get(neutre)


def lire(neutre: str, defaut=None):
    """Reglage : le nom NEUTRE d'abord, son ancien nom (profil) en secours. Vide = absent."""
    valeur = os.environ.get(neutre, "").strip()
    if valeur:
        return valeur
    ancien = nom_historique(neutre)
    if ancien:
        valeur = os.environ.get(ancien, "").strip()
        if valeur:
            return valeur
    return defaut


def exporter(env: dict, neutre: str, valeur: str) -> None:
    """Pose un reglage dans l'environnement d'un enfant, sous son nom neutre ET son ancien nom."""
    env[neutre] = valeur
    ancien = nom_historique(neutre)
    if ancien:
        env[ancien] = valeur
