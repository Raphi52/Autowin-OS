"""ENREGISTREUR DE SORTIE — nomme la mort de l'app : un code, une heure, une etiquette.

POURQUOI. Le 2026-08-17, Autowin OS est mort deux fois sans laisser de trace exploitable : aucune
exception dans `crash.log` a l'heure de la mort, aucun minidump, aucun rapport WER, l'agent en cours
termine en exit 0. La raison est simple et structurelle : PERSONNE n'attend le processus. Le lanceur
quitte des que la fenetre apparait, donc aucun parent n'est la pour recolter le code de sortie. Sans ce
chiffre, toute cause avancee reste une supposition — j'en ai avance une (le tube abandonne, corrige
par ailleurs) que la mesure a en partie contredite.

CE QU'IL FAIT. Il survit au lanceur, ouvre un handle sur les processus a surveiller, attend leur mort,
puis ecrit UNE ligne par mort dans `.autowin-data/app-exits.log` :

    2026-08-17T21:04:11 electron pid=12345 code=3221225477 (0xc0000005)

Un code negatif ou tres grand designe une terminaison Windows (violation d'acces, kill externe) ;
`code=0` designe un arret propre. C'est cette distinction qui manquait pour trancher.

Usage : py -3 scripts/enregistreur_sortie.py --racine <depot> [--pid <pid>] [--minutes 720]
"""

from __future__ import annotations

import argparse
import ctypes
import subprocess
import sys
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path

SYNCHRONIZE = 0x0010_0000
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
WAIT_OBJECT_0 = 0x0
WAIT_TIMEOUT = 0x102
STILL_ACTIVE = 259


def _noyau() -> ctypes.WinDLL:
    noyau = ctypes.WinDLL("kernel32", use_last_error=True)
    noyau.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    noyau.OpenProcess.restype = wintypes.HANDLE
    noyau.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    noyau.WaitForSingleObject.restype = wintypes.DWORD
    noyau.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    noyau.GetExitCodeProcess.restype = wintypes.BOOL
    noyau.CloseHandle.argtypes = (wintypes.HANDLE,)
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


def pids_electron(racine: Path) -> set[int]:
    """PIDs Electron de CE depot. PowerShell est la seule source fiable pour la ligne de commande."""
    requete = (
        "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
        f"Where-Object {{ $_.CommandLine -like '*{racine.name}*' }} | "
        "ForEach-Object { $_.ProcessId }"
    )
    try:
        fin = subprocess.run(  # noqa: S603 - requete fixe, aucune entree utilisateur
            ["powershell.exe", "-NoProfile", "-Command", requete],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    return {int(ligne) for ligne in fin.stdout.split() if ligne.strip().isdigit()}


def surveiller(racine: Path, journal: Path, minutes: float, pid_lanceur: int | None) -> None:
    """Boucle de surveillance : decouvre les processus, retient leur handle, journalise chaque mort.

    S'arrete d'elle-meme quand plus rien n'est vivant depuis un moment : un enregistreur immortel
    finirait par etre du bruit dans la liste des processus.
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
            # Plus rien depuis 5 minutes : l'app n'est plus la, on rend la main.
            if time.monotonic() - vide_depuis > 300:
                return
        time.sleep(2.0)  # sleep-ok: cadence de surveillance d'un processus externe


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
    surveiller(racine, journal, arguments.minutes, arguments.pid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
