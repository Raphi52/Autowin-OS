"""ENREGISTREUR DE SORTIE — nomme la mort de l'app : un code, une heure, une etiquette.

POURQUOI. Le 2026-08-17, Autowin OS est mort deux fois sans laisser de trace exploitable : aucune
exception dans `crash.log` a l'heure de la mort, aucun minidump, aucun rapport WER, l'agent en cours
termine en exit 0. La raison est structurelle : PERSONNE n'attend le processus. Le lanceur quitte des
que la fenetre apparait, donc aucun parent n'est la pour recolter le code de sortie. Sans ce chiffre,
toute cause avancee reste une supposition — j'en ai avance une (le tube abandonne, corrige par
ailleurs) que la mesure a ensuite en partie contredite.

CE QU'IL FAIT. Il survit au lanceur, ouvre un handle sur les processus a surveiller, attend leur mort,
puis ecrit UNE ligne par mort dans `.autowin-data/app-exits.log` :

    2026-08-17T19:00:58 electron pid=25352 code=4294967295 (0xffffffff) — tuee de force par un tiers

AUCUN PROCESSUS ENFANT, JAMAIS. Premiere version de ce fichier : la decouverte des processus passait
par un `powershell.exe` toutes les 2 s, SANS `CREATE_NO_WINDOW`. Resultat immediat, rapporte par
l'utilisateur : « je vois des terminaux qui se lancent en boucle a l'infini », y compris apres la
fermeture de l'app. Un outil d'observation qui pollue l'ecran de celui qu'il observe est un defaut, pas
un outil — et ce depot connaissait deja la lecon (`codex-model-source.test.ts` : « aucune console
visible sous Windows »). L'enumeration se fait donc entierement en `ctypes` dans CE processus : aucun
enfant a lancer, donc aucune console qui puisse apparaitre.

Usage : py -3 scripts/enregistreur_sortie.py --racine <depot> [--pid <pid>] [--minutes 720]
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import sys
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path

SYNCHRONIZE = 0x0010_0000
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
WAIT_OBJECT_0 = 0x0
CIBLE = "electron.exe"
# Une seule instance par depot : quatre enregistreurs qui sondent en parallele multiplient le bruit
# sans rien mesurer de plus. Le nom porte sur le CHEMIN, pour ne pas brider une seconde copie du projet —
# mais HACHE, car un nom de mutex ne peut pas contenir de `\`. Avec le chemin brut, `CreateMutexW`
# echouait, chaque instance se croyait seule, et le verrou n'excluait RIEN (mesure du 2026-08-17).
# `launch_dev.py` portait deja cette lecon, ecrite noir sur blanc ; je l'ai reapprise a mes frais.
_PREFIXE_MUTEX = "Local\\autowin-enregistreur-sortie-"


def _nom_verrou(racine: Path) -> str:
    return _PREFIXE_MUTEX + hashlib.sha1(str(racine).lower().encode("utf-8")).hexdigest()[:16]


def _noyau() -> ctypes.WinDLL:
    noyau = ctypes.WinDLL("kernel32", use_last_error=True)
    noyau.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    noyau.OpenProcess.restype = wintypes.HANDLE
    noyau.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    noyau.WaitForSingleObject.restype = wintypes.DWORD
    noyau.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    noyau.GetExitCodeProcess.restype = wintypes.BOOL
    noyau.QueryFullProcessImageNameW.argtypes = (
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    )
    noyau.QueryFullProcessImageNameW.restype = wintypes.BOOL
    noyau.CloseHandle.argtypes = (wintypes.HANDLE,)
    noyau.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    noyau.CreateMutexW.restype = wintypes.HANDLE
    return noyau


def _lisible(code: int) -> str:
    """Un code Windows brut ne parle pas ; on lui joint sa forme hexadecimale et un mot quand on peut."""
    connus = {
        0: "arret propre",
        1: "erreur applicative",
        # Mesure du 2026-08-17 : un `Stop-Process -Force` sur l'app rend exactement ce code. C'est LE
        # discriminant qui manquait — il distingue « quelqu'un l'a tuee » d'un plantage interne.
        0xFFFFFFFF: "tuee de force par un tiers (TerminateProcess)",
        0xC0000005: "violation d'acces",
        0xC0000409: "debordement de pile detecte",
        0xC000013A: "interrompu (Ctrl+C / fermeture console)",
        0x40010004: "termine par un debogueur",
    }
    mot = connus.get(code)
    return f"code={code} (0x{code:08x})" + (f" — {mot}" if mot else "")


def journaliser_mort(journal: Path, etiquette: str, pid: int, code: int) -> None:
    journal.parent.mkdir(parents=True, exist_ok=True)
    horodatage = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    with journal.open("a", encoding="utf-8") as fichier:
        fichier.write(f"{horodatage} {etiquette} pid={pid} {_lisible(code)}\n")


def attendre_et_journaliser(pid: int, journal: Path, etiquette: str, limite_s: float) -> bool:
    """Attend la mort de `pid` et l'ecrit. Rend False si le PID est introuvable ou toujours vivant.

    Ne leve jamais : un enregistreur qui casse ne mesure rien, et il tourne sans surveillance.
    """
    noyau = _noyau()
    handle = noyau.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        attente = noyau.WaitForSingleObject(handle, int(max(0.0, limite_s) * 1000))
        if attente != WAIT_OBJECT_0:
            return False
        code = wintypes.DWORD()
        if not noyau.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        journaliser_mort(journal, etiquette, pid, code.value)
        return True
    finally:
        noyau.CloseHandle(handle)


def _tous_les_pids() -> list[int]:
    """Enumere les PIDs du systeme, sans lancer le moindre processus (donc sans aucune console)."""
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    psapi.EnumProcesses.argtypes = (
        ctypes.POINTER(wintypes.DWORD),
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    )
    capacite = 4096
    while True:
        tableau = (wintypes.DWORD * capacite)()
        rendus = wintypes.DWORD()
        if not psapi.EnumProcesses(tableau, ctypes.sizeof(tableau), ctypes.byref(rendus)):
            return []
        if rendus.value < ctypes.sizeof(tableau):
            return [tableau[i] for i in range(rendus.value // ctypes.sizeof(wintypes.DWORD))]
        capacite *= 2  # tableau plein : on ne peut pas distinguer « exactement plein » de « tronque »


def chemin_du_processus(pid: int) -> str | None:
    """Chemin de l'executable d'un PID, ou None. `ctypes` seulement : aucun enfant, aucune console."""
    noyau = _noyau()
    handle = noyau.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        tampon = ctypes.create_unicode_buffer(32_768)
        taille = wintypes.DWORD(len(tampon))
        if not noyau.QueryFullProcessImageNameW(handle, 0, tampon, ctypes.byref(taille)):
            return None
        return tampon.value
    finally:
        noyau.CloseHandle(handle)


def pids_electron(racine: Path) -> set[int]:
    """PIDs Electron de CE depot, reconnus par le CHEMIN de leur binaire.

    En dev, l'executable vit dans `<depot>/node_modules/electron/dist/electron.exe` : le chemin porte
    donc le depot, ce qui est un critere plus sur que la ligne de commande et ne coute aucun enfant.
    """
    empreinte = str(racine).lower()
    trouves: set[int] = set()
    for pid in _tous_les_pids():
        chemin = chemin_du_processus(pid)
        if not chemin:
            continue
        minuscule = chemin.lower()
        if minuscule.endswith(CIBLE) and empreinte in minuscule:
            trouves.add(pid)
    return trouves


def instance_unique(racine: Path) -> bool:
    """Vrai si CE processus est le seul enregistreur pour ce depot (verrou garde vivant volontairement)."""
    global _verrou  # noqa: PLW0603 - le handle doit survivre, sinon le mutex meurt aussitot
    noyau = _noyau()
    handle = noyau.CreateMutexW(None, False, _nom_verrou(racine))
    erreur = ctypes.get_last_error()
    if not handle:
        return True  # verrou indisponible : mieux vaut mesurer que refuser de mesurer
    if erreur == 183:  # ERROR_ALREADY_EXISTS
        noyau.CloseHandle(handle)
        return False
    _verrou = handle
    return True


_verrou: int | None = None


def surveiller(
    racine: Path,
    journal: Path,
    minutes: float,
    pid_lanceur: int | None,
    cadence_s: float = 5.0,
    patience_s: float = 60.0,
) -> None:
    """Boucle de surveillance : decouvre les processus, retient leur handle, journalise chaque mort.

    S'arrete quand plus rien n'est vivant depuis `patience_s` : un enregistreur immortel finirait par
    etre du bruit dans la liste des processus — et l'utilisateur a deja vu ce que produit un veilleur
    trop bavard.
    """
    noyau = _noyau()
    handles: dict[int, tuple[int, str]] = {}
    if pid_lanceur:
        handle = noyau.OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid_lanceur
        )
        if handle:
            handles[pid_lanceur] = (handle, "dev(npm)")
    fin = time.monotonic() + minutes * 60
    vide_depuis: float | None = None
    while time.monotonic() < fin:
        for pid in pids_electron(racine) - set(handles):
            handle = noyau.OpenProcess(
                SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid
            )
            if handle:
                handles[pid] = (handle, "electron")
        for pid, (handle, etiquette) in list(handles.items()):
            if noyau.WaitForSingleObject(handle, 0) != WAIT_OBJECT_0:
                continue
            code = wintypes.DWORD()
            if noyau.GetExitCodeProcess(handle, ctypes.byref(code)):
                journaliser_mort(journal, etiquette, pid, code.value)
            noyau.CloseHandle(handle)
            del handles[pid]
        if handles:
            vide_depuis = None
        else:
            vide_depuis = vide_depuis or time.monotonic()
            if time.monotonic() - vide_depuis > patience_s:
                return
        time.sleep(min(cadence_s, 0.5))  # sleep-ok: cadence de surveillance, bornee et sans enfant
        reste = cadence_s - 0.5
        while reste > 0 and time.monotonic() < fin:
            time.sleep(min(reste, 0.5))  # sleep-ok: attente fractionnee, aucun enfant lance
            reste -= 0.5


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--racine", default=str(Path(__file__).resolve().parent.parent))
    analyseur.add_argument("--journal", default=None)
    analyseur.add_argument("--pid", type=int, default=None)
    analyseur.add_argument("--minutes", type=float, default=720.0)
    arguments = analyseur.parse_args()
    racine = Path(arguments.racine).resolve()
    journal = (
        Path(arguments.journal)
        if arguments.journal
        else racine / ".autowin-data" / "app-exits.log"
    )
    if not instance_unique(racine):
        return 0
    surveiller(racine, journal, arguments.minutes, arguments.pid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
