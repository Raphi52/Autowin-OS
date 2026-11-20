"""Tests de video_explicative.py : cadrage de la caméra, chronologie, coupe du texte, rendu d'une image par type de plan.

Lancé par : python scripts/video_explicative_test.py (code 1 si un cas échoue). Sans ffmpeg : seul le rendu est testé.
ENTRÉE QUI DOIT FAIRE ÉCHOUER : un cadre qui sort du rapport du panneau (image déformée), une caméra qui coupe la
zone demandée ou sort de la capture alors qu'elle y tient, un texte qui dépasse sa largeur, une chronologie qui
saute ou double un plan, un flou qui ne floute pas, un scénario au rectangle hors de l'image accepté.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import video_explicative as ve  # noqa: E402

ECHECS: list[str] = []


def verifie(condition: bool, message: str) -> None:
    if not condition:
        ECHECS.append(message)


def contient(r, c) -> bool:
    return r[0] <= c[0] + 1e-6 and r[1] <= c[1] + 1e-6 and r[2] >= c[2] - 1e-6 and r[3] >= c[3] - 1e-6


# 1. cadrer : bon rapport, zone contenue, rangée dans la capture quand elle y tient
for cadre, source in [((457, 310, 1268, 640), (1280, 1438)), ((0, 0, 50, 40), (1920, 1080)), ((822, 470, 1114, 625), (1920, 1080)),
                      ((25, 630, 1665, 764), (1920, 1080)), (None, (1280, 1438))]:
    r = ve.cadrer(cadre, 2.35, source, 0.08 if cadre else 0)
    w, h = r[2] - r[0], r[3] - r[1]
    verifie(abs(w / h - 2.35) < 1e-6, f"cadrer {cadre} : rapport {w / h:.4f} au lieu de 2.35")
    verifie(contient(r, cadre or (0, 0) + source), f"cadrer {cadre} : la zone n'est pas entière dans {r}")
    if w <= source[0]:
        verifie(r[0] >= -1e-6 and r[2] <= source[0] + 1e-6, f"cadrer {cadre} : sort de la capture en largeur {r}")
    if h <= source[1]:
        verifie(r[1] >= -1e-6 and r[3] <= source[1] + 1e-6, f"cadrer {cadre} : sort de la capture en hauteur {r}")
# un coin : la marge ne doit pas faire sortir de l'image, la zone reste dedans
r = ve.cadrer((0, 0, 50, 40), 2.35, (1920, 1080))
verifie(r[0] == 0 and r[1] == 0, f"cadrer coin : devrait être collé au coin, {r}")

# 2. adoucir : bornes et monotonie
verifie(ve.adoucir(0) == 0 and ve.adoucir(1) == 1 and ve.adoucir(-3) == 0 and ve.adoucir(9) == 1, "adoucir : bornes")
verifie(all(ve.adoucir(i / 50) <= ve.adoucir((i + 1) / 50) for i in range(50)), "adoucir : pas monotone")

# 3. couper_lignes : aucune ligne ne dépasse, aucun mot perdu
texte = "La date de renvoi en un geste : plus deux, quatre, six ou huit semaines, ou une date choisie."
lignes = ve.couper_lignes(texte, lambda s: 10 * len(s), 200)
verifie(all(10 * len(l) <= 200 for l in lignes), f"couper_lignes : ligne trop longue {lignes}")
verifie(" ".join(lignes).split() == texte.split(), "couper_lignes : mots perdus ou déplacés")

# 4. chronologie : bout à bout, durée des captures = somme des temps
plans = [{"type": "titre", "titre": "T", "duree": 2}, {"type": "capture", "image": "a.png", "temps": [{"duree": 1.5}, {"duree": 2.5}]},
         {"type": "liste", "titre": "L", "points": ["x"], "duree": 3}]
ch = ve.chronologie(plans)
verifie([(round(d0, 3), round(d, 3)) for _, d0, d in ch] == [(0, 2), (2, 4), (6, 3)], f"chronologie : {[(d0, d) for _, d0, d in ch]}")

# 5. rendu : une image par type de plan, à la bonne taille ; le flou floute ; le scénario fautif est refusé
with tempfile.TemporaryDirectory() as dossier:
    base = Path(dossier)
    im = Image.new("RGB", (640, 400), "white")
    d = ImageDraw.Draw(im)
    for x in range(0, 640, 8):
        d.line((x, 0, x, 400), fill="black", width=3)  # rayures : un flou les efface
    im.save(base / "a.png")
    Image.new("RGB", (200, 400), "white").save(base / "b.png")
    sc = {"taille": [480, 270], "fps": 10, "entete": "essai", "plans": [
        {"type": "titre", "titre": "Titre", "sous_titre": "sous-titre", "mention": "mention", "duree": 1},
        {"type": "chapitre", "numero": 1, "titre": "Chapitre", "sous_titre": "s", "duree": 1, "rubrique": "Partie"},
        {"type": "capture", "image": "a.png", "flous": [[0, 0, 160, 100]],
         "temps": [{"cadre": None, "texte": "vue", "duree": 1}, {"cadre": [300, 200, 500, 300], "surligne": True, "texte": "zoom", "duree": 1}]},
        {"type": "extraits", "image": "a.png", "bandes": [[0, 0, 640, 50], [0, 300, 640, 360]], "surligne": [1], "texte": "x", "duree": 1},
        {"type": "cote_a_cote", "images": ["a.png", "b.png"], "texte": "x", "duree": 1},
        {"type": "liste", "titre": "Liste", "points": ["un", "deux"], "numerote": True, "conclusion": "fin", "duree": 1}]}
    verifie(ve.verifier_scenario(sc, base) == [], f"scénario valide refusé : {ve.verifier_scenario(sc, base)}")
    r = ve.Rendu(sc, base)
    verifie(abs(r.total - 7) < 1e-6, f"durée totale {r.total} au lieu de 7")
    for nom, t in r.temps_forts():
        f = r.image_a(t)
        verifie(f.size == (480, 270) and f.mode == "RGB", f"{nom} : image {f.size} {f.mode}")
    floue = r.image("a.png", [[0, 0, 160, 100]])
    lo, hi = floue.crop((20, 20, 140, 80)).convert("L").getextrema()
    verifie(hi - lo < 120, "flou : les rayures restent nettes")
    lo, hi = floue.crop((300, 200, 420, 260)).convert("L").getextrema()
    verifie(hi - lo > 200, "flou : a débordé hors de sa zone")
    # l'accent d'une capitale n'est pas coupé au bord haut du texte rendu
    for police in ("titrage", "gras", "demi", "texte"):
        b = r.bloc_texte("À ÉTÉ", police, 40, "accent", 800)
        verifie(b.getchannel("A").getbbox()[1] > 0, f"{police} : l'accent de « À » touche le bord haut (coupé)")
    sc["plans"][2]["temps"][1]["cadre"] = [300, 200, 900, 300]
    sc["plans"].append({"type": "inconnu"})
    defauts = ve.verifier_scenario(sc, base)
    verifie(any("hors de a.png" in x for x in defauts), f"rectangle hors image accepté : {defauts}")
    verifie(any("type inconnu" in x for x in defauts), f"type inconnu accepté : {defauts}")

# 6. voix off : numérotation des moments, texte pour l'outil de voix, calage des durées, piste posée au bon instant
plans = [{"type": "titre", "titre": "T", "duree": 2, "voix": "Bonjour."},
         {"type": "capture", "image": "a.png", "temps": [{"duree": 1.5}, {"duree": 2.5, "voix": "Ici, la date."}]},
         {"type": "liste", "titre": "L", "points": ["x"], "duree": 3, "voix": "Et ensuite ?"}]
verifie(len(ve.segments(plans)) == 4, f"segments : {len(ve.segments(plans))} au lieu de 4 (un par temps de capture)")
md = ve.script_voix(plans)
verifie("## 1. " in md and "## 3. " in md and "## 4. " in md and "## 2. " not in md,
        f"script_voix : numéros faux (le moment 2 n'a pas de voix) :\n{md}")
verifie("### Voix\n\nIci, la date." in md, f"script_voix : texte du moment 3 absent :\n{md}")
cales = ve.caler_sur_voix(plans, {1: 1.0, 3: 4.0, 4: 2.0}, avant=0.3, apres=0.3)
verifie([round(ve.duree_plan(p), 3) for p in cales] == [2, 1.5 + 4.6, 3], f"calage : {[ve.duree_plan(p) for p in cales]}")
verifie(plans[1]["temps"][1]["duree"] == 2.5, "calage : le scénario d'origine a été modifié")
taux = 1000
voix = {3: b"\x01\x00" * 500, 1: b"\x02\x00" * 100}
piste = ve.piste_voix(cales, voix, taux, avant=0.3)
total = sum(ve.duree_plan(p) for p in cales)
verifie(len(piste) == 2 * round(total * taux), f"piste : {len(piste)} octets au lieu de {2 * round(total * taux)}")
debut3 = round((2 + 1.5 + 0.3) * taux)  # titre (2 s) + premier temps (1,5 s) + l'attente avant la voix
verifie(piste[2 * debut3:2 * debut3 + 2] == b"\x01\x00" and piste[2 * debut3 - 2:2 * debut3] == b"\x00\x00",
        "piste : la voix du moment 3 ne commence pas à son instant")
verifie(piste[2 * 300:2 * 300 + 2] == b"\x02\x00", "piste : la voix du moment 1 ne commence pas après l'attente")
# la voix d'un moment s'arrête à la fin de son moment, même si son fichier (silence de fin) déborde
longue = {1: b"\x02\x00" * 5000}
p1 = ve.piste_voix(cales, longue, taux, avant=0.3)
verifie(p1[2 * 2000:2 * 2000 + 2] == b"\x00\x00", "piste : la voix du moment 1 déborde sur le moment suivant")
# durée parlée : jusqu'au dernier son, sans le silence que l'outil de voix ajoute à la fin
son = (b"\x00\x00" * 200) + (b"\x10\x27" * 1000) + (b"\x00\x00" * 1300)  # 0,2 s de silence, 1 s de son, 1,3 s de silence
verifie(abs(ve.duree_parlee(son, 1000) - 1.2) < 0.01, f"duree_parlee : {ve.duree_parlee(son, 1000)} au lieu de 1.2")
verifie(ve.duree_parlee(b"\x00\x00" * 500, 1000) == 0, "duree_parlee : un silence doit valoir 0")
with tempfile.TemporaryDirectory() as dossier:
    (Path(dossier) / "03.pcm").write_bytes(b"\x00\x00" * 12000)
    (Path(dossier) / "03.json").write_text("[]", encoding="utf-8")
    lues = ve.lire_voix(Path(dossier))
    verifie(list(lues) == [3] and len(lues[3]) == 24000, f"lire_voix : {list(lues)}")

# --help dans une console Windows (cp1252) : l'aide contient « → », que cette console ne sait pas écrire.
import os  # noqa: E402
import subprocess  # noqa: E402

aide = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "video_explicative.py"), "--help"],
                      capture_output=True, env={**os.environ, "PYTHONIOENCODING": "cp1252"})
verifie(aide.returncode == 0, f"--help sous cp1252 : code {aide.returncode} ({aide.stderr.decode('utf-8', 'replace')[-120:]})")

if ECHECS:
    print("ÉCHECS :\n- " + "\n- ".join(ECHECS))
    sys.exit(1)
print("video_explicative : tous les cas passent")
