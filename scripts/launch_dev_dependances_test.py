"""Test de launch_dev_dependances : `py -3 scripts/launch_dev_dependances_test.py` (exit 0 = vert)."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launch_dev_dependances import dependances_manquantes, electron_verrouille  # noqa: E402

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


def paquet(racine: Path, chemin: str) -> None:
    (racine / chemin).mkdir(parents=True, exist_ok=True)
    (racine / chemin / "package.json").write_text("{}", encoding="utf-8")


with tempfile.TemporaryDirectory() as tmp:
    r = Path(tmp)
    (r / "package-lock.json").write_text(
        json.dumps(
            {
                "packages": {
                    "": {"name": "x"},
                    "node_modules/electron-vite": {"bin": {"electron-vite": "bin/electron-vite.js"}},
                    "node_modules/@babel/core": {},
                    "node_modules/a/node_modules/b": {},
                    "node_modules/@esbuild/linux-x64": {"optional": True},
                }
            }
        ),
        encoding="utf-8",
    )
    for p in ("node_modules/electron-vite", "node_modules/@babel/core", "node_modules/a/node_modules/b"):
        paquet(r, p)
    (r / "node_modules" / ".bin").mkdir(parents=True)
    (r / "node_modules" / ".bin" / "electron-vite.cmd").write_text("", encoding="utf-8")
    verifie(dependances_manquantes(r) == [], "arbre complet : rien a reparer (l'optionnel d'une autre plateforme est ignore)")

    (r / "node_modules" / ".bin" / "electron-vite.cmd").unlink()
    verifie(
        dependances_manquantes(r) == ["node_modules/.bin/electron-vite"],
        "panne du 2026-10-02 : `.bin` vide alors que le paquet est la -> detectee",
    )

    (r / "node_modules" / "@babel" / "core" / "package.json").unlink()
    verifie(
        "node_modules/@babel/core" in dependances_manquantes(r),
        "panne du 2026-10-05 : @babel/core absent -> detecte",
    )

    (r / "package-lock.json").write_text("{pas du json", encoding="utf-8")
    verifie(dependances_manquantes(r) == [], "lock illisible : on ne repare pas sur une reference inconnue")

    verifie(electron_verrouille(r) is False, "pas d'electron.exe : rien ne verrouille")
    exe = r / "node_modules" / "electron" / "dist" / "electron.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    verifie(electron_verrouille(r) is False, "electron.exe libre : la reparation peut partir")

    # Conv-266 : `logo_anneau.poser_sur_electron` RENOMME l'exe tenu en `electron-atome-<n>.exe` et
    # pose un electron.exe neuf, donc LIBRE. Les processus en cours tournent sur l'ancien : une
    # reinstallation d'Electron buterait dessus (EBUSY), exactement la panne qui videait node_modules.
    if sys.platform == "win32":
        import ctypes

        noyau = ctypes.windll.kernel32  # type: ignore[attr-defined]
        noyau.CreateFileW.restype = ctypes.c_void_p
        ancien = exe.parent / "electron-atome-1791730503238413200.exe"
        ancien.write_bytes(b"")
        # Ouverture SANS partage en ecriture : ce que fait Windows d'un exe en cours d'execution.
        poignee = noyau.CreateFileW(str(ancien), 0x80000000, 0x1, None, 3, 0x80, None)
        try:
            verifie(electron_verrouille(r) is True,
                    "un ancien electron mis de cote et encore TENU bloque la reparation")
        finally:
            noyau.CloseHandle(ctypes.c_void_p(poignee))
        verifie(electron_verrouille(r) is False, "ancien electron mis de cote mais LIBRE : la reparation peut partir")
        ancien.unlink()

        # L'app tourne sur l'EXE DE DEV (electron_dev.py) : electron.exe d'npm est libre, mais les DLL
        # d'npm sont tenues (liens durs) et l'app charge ses modules natifs depuis node_modules.
        dev = r / ".autowin-data" / "electron-dev" / "electron.exe"
        dev.parent.mkdir(parents=True)
        dev.write_bytes(b"")
        poignee = noyau.CreateFileW(str(dev), 0x80000000, 0x1, None, 3, 0x80, None)
        try:
            verifie(electron_verrouille(r) is True, "l'app sur l'exe de DEV bloque la reparation de node_modules")
        finally:
            noyau.CloseHandle(ctypes.c_void_p(poignee))
        verifie(electron_verrouille(r) is False, "exe de dev libre : la reparation peut partir")

# Le vrai depot, si l'app tourne : electron.exe DOIT etre vu verrouille (sonde reelle, pas un faux).
depot = Path(__file__).resolve().parent.parent
if "--app-ouverte" in sys.argv:
    verifie(electron_verrouille(depot) is True, "app ouverte : electron.exe du depot vu verrouille")

if ECHECS:
    for message in ECHECS:
        print("FAIL:", message)
    sys.exit(1)
print("PASS launch_dev_dependances")
