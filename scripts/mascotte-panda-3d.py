"""
Les trois pandas de la mascotte — GÉNÉRÉS : ne pas éditer le module TypeScript à la main.

Blender, en arrière-plan (aucune fenêtre), modèle un panda en primitives, articulé : cou, épaules,
coudes, hanches, genoux. Chaque patte de bras va au point voulu par cinématique inverse, et le coude
se plie comme une charnière ; chaque jambe se pose par la hanche et le genou, la cheville gardant le
pied à plat.

Trois pandas, chacun avec son visuel et ses gestes (on peut garder le visuel de l'un et les gestes de
l'autre) :
- panda1 · classique : au repos il salue de la main droite ; au travail il tient une lueur entre les mains.
- panda2 · au bambou : un bambou dans la main droite ; au repos il le grignote, au travail il tape en rythme.
- panda3 · à l'écharpe : corps plus rond, écharpe rouge ; au repos il danse, au travail il applaudit.

Pour chaque panda, deux états, 16 images chacun, fond transparent :
- calme : le repos, l'attente et le problème ;
- travail.
Chaque état est réduit de 2x (bords lissés), puis ses 16 images sont rangées côte à côte, 104 x 125 px
l'une. Les planches partent dans `src/main/mascotte/mascotte-panda-images.ts`, en données PNG.

La fenêtre de la mascotte n'admet aucun script : la 3D y est donc rejouée en CSS, par `steps(16)`,
comme la machine NieR (`mascotte-machine-images.ts`).

Lancer depuis la racine du dépôt :
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P scripts/mascotte-panda-3d.py -- <dossier-de-travail>
Ajouter `--controle` après le dossier : rend seulement une feuille de contrôle (chaque état de chaque
panda à quatre instants, en double taille) dans ce dossier. Le module TypeScript n'est pas réécrit.
"""

import base64
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

IMAGES = 16  # steps(16) dans la page
LARGEUR = 104  # une image affichée, en px CSS
HAUTEUR = 125
ECHELLE = 2  # rendu à 2x puis réduit à 1x : bords lissés

try:
    RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
except NameError:
    RACINE = os.getcwd()
SORTIE_TS = os.path.join(RACINE, "src", "main", "mascotte", "mascotte-panda-images.ts")

BLANC = (0.92, 0.92, 0.9)
NOIR = (0.03, 0.03, 0.035)
BLANC_OEIL = (0.95, 0.95, 0.95)
NOIR_PUPILLE = (0.01, 0.01, 0.012)
ORBE = (1.0, 0.7, 0.3)
ORBE_LUEUR = (1.0, 0.62, 0.22)
VERT = (0.20, 0.50, 0.17)
VERT_NOEUD = (0.09, 0.26, 0.07)
ROUGE = (0.78, 0.09, 0.07)

CORPS_CLASSIQUE = (0.82, 0.72, 0.95)
CORPS_RONDI = (0.92, 0.82, 1.00)

# Squelette, en unités Blender : Z vers le haut ; le panda regarde vers -Y, où est la caméra.
COU = (0.0, 0.0, 1.55)  # pivot de la tête
EPAULE = (0.66, 0.0, 1.42)  # par côté : x signé
HANCHE = (0.40, 0.0, 0.10)  # par côté : x signé
BRAS_HAUT = 0.52  # épaule -> coude
AVANT_BRAS = 0.52  # coude -> poignet
CUISSE = 0.22  # hanche -> genou
MOLLET = 0.20  # genou -> cheville

# Points visés par les pattes, en coordonnées du panda, côté droit à l'écran ; le gauche est en miroir.
# Chacun reste à portée de bras (1,04) depuis l'épaule : `verifier` le contrôle à chaque image.
REPOS_DROIT = Vector((0.74, -0.10, 0.52))  # le long du corps
SALUT_DROIT = Vector((1.02, -0.10, 1.90))  # main levée pour saluer
HAUT_DROIT = Vector((0.92, -0.05, 2.02))  # bras levé, en l'air
REPOS_BAMBOU = Vector((0.50, -0.70, 0.95))  # le bambou tenu devant le ventre, au repos : il se voit
BOUCHE = Vector((0.30, -0.80, 1.72))  # le bambou tenu jusqu'à la bouche
TAPE_DROIT = Vector((0.42, -0.80, 0.98))  # la patte tape devant le ventre
ECARTE_DROIT = Vector((0.45, -0.75, 1.02))  # mains écartées, devant la poitrine
RENCONTRE_DROIT = Vector((0.12, -0.80, 1.10))  # mains qui se rejoignent pour applaudir


def miroir(v):
    return Vector((-v.x, v.y, v.z))


INSTANTS = [i / IMAGES for i in range(IMAGES)]


def options():
    apres = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    controle = "--controle" in apres
    chemins = [a for a in apres if a != "--controle"]
    dossier = chemins[0] if chemins else tempfile.mkdtemp(prefix="panda-")
    os.makedirs(dossier, exist_ok=True)
    return dossier, controle


def monde_vide():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32  # le débruitage lisse ; la planche est ensuite réduite de moitié
    try:
        scene.cycles.use_denoising = True
    except AttributeError:
        pass
    scene.render.resolution_x = LARGEUR * ECHELLE
    scene.render.resolution_y = HAUTEUR * ECHELLE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass
    return scene


def materiau(couleur, rugosite, lueur=None, force=0.0):
    m = bpy.data.materials.new("panda")
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*couleur, 1.0)
    bsdf.inputs["Roughness"].default_value = rugosite
    if lueur is not None:
        bsdf.inputs["Emission Color"].default_value = (*lueur, 1.0)
        bsdf.inputs["Emission Strength"].default_value = force
    return m, bsdf


def lier(objet):
    bpy.context.collection.objects.link(objet)
    return objet


def vide(nom, position, parent=None):
    # Une articulation : un point de pivot, sans forme, qui porte ce qui lui est attaché.
    o = lier(bpy.data.objects.new(nom, None))
    if parent is not None:
        o.parent = parent
    o.location = position
    return o


def sphere(nom, position, echelle, materiau_, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=40, ring_count=20)
    o = bpy.context.active_object
    o.name = nom
    o.data.materials.append(materiau_)
    for p in o.data.polygons:
        p.use_smooth = True
    o.parent = parent
    o.location = position
    o.scale = echelle
    return o


def anneau(nom, rayon, tube, position, materiau_, parent, segments=40, sections=12):
    # Un tore posé à plat, construit sommet par sommet : une écharpe qui fait le tour du haut du corps.
    sommets = []
    for i in range(segments):
        u = 2 * math.pi * i / segments
        for j in range(sections):
            v = 2 * math.pi * j / sections
            r = rayon + tube * math.cos(v)
            sommets.append((r * math.cos(u), r * math.sin(u), tube * math.sin(v)))
    faces = []
    for i in range(segments):
        for j in range(sections):
            a = i * sections + j
            b = ((i + 1) % segments) * sections + j
            c = ((i + 1) % segments) * sections + (j + 1) % sections
            d = i * sections + (j + 1) % sections
            faces.append((a, b, c, d))
    maille = bpy.data.meshes.new(f"{nom}-maille")
    maille.from_pydata(sommets, [], faces)
    maille.update()
    for p in maille.polygons:
        p.use_smooth = True
    maille.materials.append(materiau_)
    o = lier(bpy.data.objects.new(nom, maille))
    o.parent = parent
    o.location = position
    return o


def baton(parent):
    # Un bambou : une tige verte avec deux nœuds plus sombres ; la patte droite le tient par le bas.
    vert, _ = materiau(VERT, 0.4)
    noeud, _ = materiau(VERT_NOEUD, 0.4)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.075, depth=0.95)
    tige = bpy.context.active_object
    tige.name = "bambou"
    tige.data.materials.append(vert)
    tige.parent = parent
    for z in (-0.22, 0.18):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.092, depth=0.06, location=(0.0, 0.0, z))
        n = bpy.context.active_object
        n.name = "bambou-noeud"
        n.data.materials.append(noeud)
        n.parent = tige
    return tige


def echarpe(parent):
    rouge, _ = materiau(ROUGE, 0.45)
    anneau("echarpe", 0.90, 0.09, (0.0, 0.0, 1.30), rouge, parent)
    sphere("echarpe-noeud", (0.0, -0.92, 1.22), (0.16, 0.13, 0.13), rouge, parent)


def sur_le_cou(p):
    # La tête est repérée en coordonnées du panda, puis ramenée au cou : elle pivote avec lui.
    return (p[0] - COU[0], p[1] - COU[1], p[2] - COU[2])


def epaule_de(sx):
    return Vector((sx * EPAULE[0], EPAULE[1], EPAULE[2]))


def construire(variante):
    racine = vide("PandaRacine", (0.0, 0.0, 0.0))
    blanc, _ = materiau(BLANC, 0.5)
    noir, _ = materiau(NOIR, 0.45)
    blanc_oeil, _ = materiau(BLANC_OEIL, 0.12)
    pupille, _ = materiau(NOIR_PUPILLE, 0.1)
    orbe_mat, orbe_bsdf = materiau(ORBE, 0.25, lueur=ORBE_LUEUR, force=5.0)

    corps = sphere("corps", (0.0, 0.0, 0.75), variante["corps"], blanc, racine)
    sphere("queue", (0.0, 0.82, 0.3), (0.2, 0.2, 0.2), blanc, racine)

    cou = vide("cou", COU, racine)
    sphere("tete", sur_le_cou((0.0, 0.02, 2.05)), (0.9, 0.9, 0.9), blanc, cou)
    yeux = []
    for sx in (-1, 1):
        sphere("oreille", sur_le_cou((sx * 0.6, 0.0, 2.72)), (0.3, 0.3, 0.3), noir, cou)
        sphere("patte-oeil", sur_le_cou((sx * 0.36, -0.78, 2.12)), (0.25, 0.11, 0.33), noir, cou)
        oeil = sphere("oeil", sur_le_cou((sx * 0.34, -0.88, 2.2)), (0.12, 0.08, 0.13), blanc_oeil, cou)
        pup = sphere("pupille", sur_le_cou((sx * 0.34, -0.945, 2.2)), (0.06, 0.04, 0.07), pupille, cou)
        yeux += [(oeil, oeil.scale.copy()), (pup, pup.scale.copy())]
    sphere("nez", sur_le_cou((0.0, -0.93, 1.93)), (0.12, 0.09, 0.09), noir, cou)

    bras = {}
    pattes = {}
    for sx in (-1, 1):
        cote = "gauche" if sx < 0 else "droite"  # à l'écran
        epaule = vide(f"epaule-{cote}", tuple(epaule_de(sx)), racine)
        sphere(f"bras-haut-{cote}", (0.0, 0.0, -BRAS_HAUT / 2), (0.24, 0.24, BRAS_HAUT / 2 + 0.14), noir, epaule)
        coude = vide(f"coude-{cote}", (0.0, 0.0, -BRAS_HAUT), epaule)
        sphere(f"avant-bras-{cote}", (0.0, 0.0, -AVANT_BRAS / 2), (0.2, 0.2, AVANT_BRAS / 2 + 0.12), noir, coude)
        patte = sphere(f"patte-{cote}", (0.0, 0.0, -AVANT_BRAS), (0.21, 0.21, 0.19), noir, coude)
        bras[sx] = {"epaule": epaule, "coude": coude, "patte": patte}

        hanche = vide(f"hanche-{cote}", (sx * HANCHE[0], HANCHE[1], HANCHE[2]), racine)
        sphere(f"cuisse-{cote}", (0.0, 0.0, -CUISSE / 2), (0.2, 0.2, CUISSE / 2 + 0.12), noir, hanche)
        genou = vide(f"genou-{cote}", (0.0, 0.0, -CUISSE), hanche)
        sphere(f"mollet-{cote}", (0.0, 0.0, -MOLLET / 2), (0.17, 0.17, MOLLET / 2 + 0.1), noir, genou)
        cheville = vide(f"cheville-{cote}", (0.0, 0.0, -MOLLET), genou)
        sphere(f"pied-{cote}", (0.0, -0.07, -0.05), (0.17, 0.23, 0.12), noir, cheville)
        pattes[sx] = {"hanche": hanche, "genou": genou, "cheville": cheville}

    orbe = sphere("orbe", (0.0, -0.90, 1.20), (0.24, 0.24, 0.24), orbe_mat, racine)
    squelette = {
        "racine": racine,
        "corps": corps,
        "corps_base": variante["corps"],
        "cou": cou,
        "yeux": yeux,
        "bras": bras,
        "pattes": pattes,
        "orbe": orbe,
        "orbe_bsdf": orbe_bsdf,
    }
    if variante["accessoire"] == "bambou":
        squelette["baton"] = baton(racine)
    elif variante["accessoire"] == "echarpe":
        echarpe(racine)
    return squelette


def eclairage():
    def soleil(nom, energie, rotation):
        d = bpy.data.lights.new(nom, "SUN")
        d.energy = energie
        o = lier(bpy.data.objects.new(nom, d))
        o.rotation_euler = rotation

    soleil("Cle", 4.0, (1.05, 0.0, -0.5))
    soleil("Remplissage", 1.2, (0.9, 0.0, 0.9))
    monde = bpy.data.worlds.new("Monde")
    bpy.context.scene.world = monde
    monde.use_nodes = True
    fond = next(n for n in monde.node_tree.nodes if n.type == "BACKGROUND")
    fond.inputs["Color"].default_value = (0.8, 0.8, 0.82, 1.0)
    fond.inputs["Strength"].default_value = 0.6


def camera(scene):
    # Un peu plus serrée qu'avant : les membres, plus fins, gardent une taille lisible.
    d = bpy.data.cameras.new("Camera")
    d.lens = 58
    d.sensor_fit = "VERTICAL"
    d.sensor_height = 24
    cam = lier(bpy.data.objects.new("Camera", d))
    cam.location = (0.0, -10.0, 2.0)
    cible = Vector((0.0, 0.0, 1.25))
    cam.rotation_euler = (cible - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam


def resoudre_bras(epaule, cible, pole):
    """Cinématique inverse à deux segments.

    Renvoie (orientation de l'épaule, angle du coude, poignet atteint). La patte vise `cible`, en
    coordonnées du panda ; le coude se plie dans le plan qui passe par `pole` et ne tourne que sur
    son axe X, comme une charnière.
    """
    v = cible - epaule
    d = min(v.length, (BRAS_HAUT + AVANT_BRAS) * 0.999)
    u = v.normalized()
    a = (BRAS_HAUT**2 - AVANT_BRAS**2 + d * d) / (2.0 * d)
    h = math.sqrt(max(BRAS_HAUT**2 - a * a, 0.0))
    p = pole - epaule
    n = (p - u * p.dot(u)).normalized()
    axe = u.cross(n).normalized()
    coude = epaule + u * a + n * h
    poignet = epaule + u * d

    def repere(sens):
        # Repère d'un segment : son axe -Z suit `sens`, son axe X est la charnière du coude.
        z = -sens
        y = z.cross(axe)
        return Matrix((axe, y, z)).transposed()

    bras = repere((coude - epaule).normalized())
    avant = bras.transposed() @ (poignet - coude).normalized()
    theta = math.atan2(avant.y, -avant.z)
    return bras.to_euler("XYZ"), theta, poignet


def pole_de(sx, travail):
    # Où pointe le coude : vers le bas et l'extérieur quand les mains tiennent quelque chose, vers l'avant au repos.
    decalage = Vector((sx * 0.5, -0.1, -0.9)) if travail else Vector((sx * 0.2, -0.7, -0.6))
    return epaule_de(sx) + decalage


def poser_bras(bras, sx, cible, pole):
    orientation, theta, poignet = resoudre_bras(epaule_de(sx), cible, pole)
    bras["epaule"].rotation_euler = orientation
    bras["coude"].rotation_euler = (theta, 0.0, 0.0)
    return poignet


def poser_bras_vers(squelette, cibles, travail):
    # Renvoie [(patte, poignet, cible)] pour le gauche puis le droit : `verifier` contrôle chaque point.
    controles = []
    for sx in (-1, 1):
        poignet = poser_bras(squelette["bras"][sx], sx, cibles[sx], pole_de(sx, travail))
        controles.append((squelette["bras"][sx]["patte"], poignet, cibles[sx]))
    return controles


def poser_jambe(jambe, hanche, genou, ecart=0.0):
    # La cheville compense la hanche et le genou : le pied reste à plat. Vu de face, seul ce qui
    # bouge à l'écran se lit : la levée du pied et l'écart latéral (`ecart`), pas l'avant-arrière.
    jambe["hanche"].rotation_euler = (hanche, 0.0, ecart)
    jambe["genou"].rotation_euler = (genou, 0.0, 0.0)
    jambe["cheville"].rotation_euler = (-(hanche + genou), 0.0, 0.0)


def poser_pieds_plats(squelette):
    for sx in (-1, 1):
        poser_jambe(squelette["pattes"][sx], 0.0, 0.05)


def poser_corps(squelette, s, c, amplitude=0.30):
    # Le corps entier tourne sur lui-même : c'est ce qui donne la 3D à la boucle.
    squelette["racine"].rotation_euler = (0.0, 0.0, amplitude * s)
    squelette["racine"].location = (0.0, 0.0, 0.035 * (1.0 - c))
    b = squelette["corps_base"]
    squelette["corps"].scale = (b[0], b[1], b[2] * (1.0 + 0.012 * s))


def poser_tete(squelette, pas, roulis):
    squelette["cou"].rotation_euler = (pas, 0.0, roulis)


def poser_yeux(squelette, clin):
    for o, base in squelette["yeux"]:
        o.scale = (base.x, base.y, base.z * (1.0 - 0.9 * clin))


def poser_baton(squelette, poignet, inclinaison):
    # Le bambou part du poignet : la patte le tient par le bas, il s'incline d'un angle donné vers l'avant.
    axe = Vector((0.0, -math.sin(inclinaison), math.cos(inclinaison)))
    squelette["baton"].location = tuple(poignet + axe * 0.30)
    squelette["baton"].rotation_euler = (inclinaison, 0.0, 0.0)


def sinus(t):
    return math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)


def salut(t):
    """Le bras droit (à l'écran) se lève, agite la patte une fois, puis se rabat : une fenêtre de la boucle.

    Renvoie (levée, agitation) entre -1 et 1 ; hors de la fenêtre, le bras reste le long du corps.
    """
    u = (t - 0.62) / 0.28
    if not 0.0 <= u <= 1.0:
        return 0.0, 0.0
    levee = math.sin(math.pi * u)
    return levee, math.sin(2 * math.pi * u) * levee


# --- panda1 · classique ---------------------------------------------------------------------------


def poser_calme(t, squelette):
    s, c = sinus(t)
    poser_corps(squelette, s, c)
    poser_tete(squelette, 0.02 * c, 0.06 * s)
    # Clignement au repos seulement : au travail, les yeux restent ouverts.
    poser_yeux(squelette, max(0.0, 1.0 - abs(t - 0.78) / 0.05))
    squelette["orbe"].hide_render = True
    levee, agitation = salut(t)
    cibles = {
        -1: miroir(REPOS_DROIT) + Vector((0.0, 0.05 * s, 0.02 * c)),
        1: REPOS_DROIT.lerp(SALUT_DROIT, levee) + Vector((0.14 * agitation, 0.0, 0.0)),
    }
    controles = poser_bras_vers(squelette, cibles, False)
    poser_jambe(squelette["pattes"][-1], 0.02 * s, 0.05 + 0.02 * c)
    poser_jambe(squelette["pattes"][1], -0.02 * s, 0.05 - 0.02 * c)
    return controles


def poser_travail(t, squelette):
    s, c = sinus(t)
    poser_corps(squelette, s, c, amplitude=0.18)
    poser_tete(squelette, 0.14 + 0.03 * s, 0.05 * s)
    poser_yeux(squelette, 0.0)
    # Les deux pattes tiennent l'orbe de chaque côté ; elles suivent son léger mouvement.
    centre = Vector((0.0, -0.90, 1.20 + 0.03 * c))
    squelette["orbe"].location = tuple(centre)
    squelette["orbe"].hide_render = False
    squelette["orbe_bsdf"].inputs["Emission Strength"].default_value = 8.0 + 3.0 * s
    cibles = {
        -1: centre + Vector((-0.34, 0.05, -0.02 + 0.015 * s)),
        1: centre + Vector((0.34, 0.05, -0.02 - 0.015 * s)),
    }
    controles = poser_bras_vers(squelette, cibles, True)
    # La jambe droite (à l'écran) trépigne deux fois par boucle : le pied se lève et s'écarte un peu,
    # la gauche reste posée.
    tape = max(0.0, math.sin(4 * math.pi * t))
    poser_jambe(squelette["pattes"][-1], 0.0, 0.05)
    poser_jambe(squelette["pattes"][1], -0.90 * tape, 0.05 + 0.60 * tape, ecart=0.12 * tape)
    return controles


# --- panda2 · au bambou ---------------------------------------------------------------------------


def poser_mache(t, squelette):
    s, c = sinus(t)
    poser_corps(squelette, s, c, amplitude=0.20)
    # Une bouchée par boucle : le bambou monte à la bouche et la tête s'incline vers lui en mâchant.
    montee = min(1.0, max(0.0, (t - 0.20) / 0.12))
    descente = min(1.0, max(0.0, (0.56 - t) / 0.12))
    levee = min(montee, descente)
    mache = 0.03 * math.sin(2 * math.pi * 3 * t) * levee
    poser_tete(squelette, 0.10 * levee + 0.02 * c, 0.04 * s)
    poser_yeux(squelette, max(0.0, 1.0 - abs(t - 0.78) / 0.05))
    squelette["orbe"].hide_render = True
    cibles = {
        -1: miroir(REPOS_DROIT) + Vector((0.0, 0.05 * s, 0.02 * c)),
        1: REPOS_BAMBOU.lerp(BOUCHE, levee) + Vector((0.0, mache, mache)),
    }
    controles = poser_bras_vers(squelette, cibles, False)
    poser_baton(squelette, controles[1][1], 0.25)
    poser_pieds_plats(squelette)
    return controles


def poser_tape(t, squelette):
    s, c = sinus(t)
    poser_corps(squelette, 0.0, c, amplitude=0.10)
    # Deux coups par boucle, alternés : chaque patte tape devant le ventre, la tête suit le rythme.
    frappe_d = max(0.0, math.sin(4 * math.pi * t))
    frappe_g = max(0.0, math.sin(4 * math.pi * t + math.pi))
    poser_tete(squelette, 0.05 * max(frappe_d, frappe_g), 0.03 * s)
    poser_yeux(squelette, 0.0)
    squelette["orbe"].hide_render = True
    cibles = {
        -1: miroir(TAPE_DROIT) + Vector((0.0, -0.04 * frappe_g, 0.12 * frappe_g)),
        1: TAPE_DROIT + Vector((0.0, -0.04 * frappe_d, 0.12 * frappe_d)),
    }
    controles = poser_bras_vers(squelette, cibles, True)
    poser_baton(squelette, controles[1][1], 0.90)
    poser_pieds_plats(squelette)
    return controles


# --- panda3 · à l'écharpe -------------------------------------------------------------------------


def poser_danse(t, squelette):
    s, c = sinus(t)
    s2 = math.sin(4 * math.pi * t)  # deux temps par boucle : les bras et les pieds alternent
    droite = max(0.0, s2)
    gauche = max(0.0, -s2)
    poser_corps(squelette, 0.5 * s, c, amplitude=0.22)
    squelette["racine"].location = (0.0, 0.0, 0.06 * max(droite, gauche))  # le corps rebondit à chaque temps
    poser_tete(squelette, 0.03 * c, 0.10 * s)
    poser_yeux(squelette, 0.0)
    squelette["orbe"].hide_render = True
    cibles = {
        -1: miroir(REPOS_DROIT).lerp(miroir(HAUT_DROIT), gauche),
        1: REPOS_DROIT.lerp(HAUT_DROIT, droite),
    }
    controles = poser_bras_vers(squelette, cibles, False)
    for sx, p in ((-1, gauche), (1, droite)):
        poser_jambe(squelette["pattes"][sx], 0.0, 0.05 + 0.50 * p, ecart=0.12 * p * sx)
    return controles


def poser_applaudit(t, squelette):
    s, c = sinus(t)
    frappe = max(0.0, math.sin(4 * math.pi * t))  # deux claquements par boucle
    poser_corps(squelette, 0.0, c, amplitude=0.10)
    squelette["racine"].location = (0.0, 0.0, 0.04 * frappe)
    poser_tete(squelette, 0.05 * frappe, 0.0)
    poser_yeux(squelette, 0.35)  # les yeux se plissent : c'est la joie
    squelette["orbe"].hide_render = True
    cibles = {
        -1: miroir(ECARTE_DROIT).lerp(miroir(RENCONTRE_DROIT), frappe),
        1: ECARTE_DROIT.lerp(RENCONTRE_DROIT, frappe),
    }
    controles = poser_bras_vers(squelette, cibles, False)
    poser_pieds_plats(squelette)
    return controles


# --- contrôle et rendu ----------------------------------------------------------------------------


def verifier(squelette, controles):
    """Contrôle sur l'artefact : dans Blender, chaque patte est bien au point calculé, et ce point est atteint."""
    bpy.context.view_layer.update()
    racine = squelette["racine"]
    for patte, poignet, cible in controles:
        assert (poignet - cible).length < 1e-3, f"cible hors d'atteinte : {tuple(cible)}"
        attendu = (racine.matrix_world @ poignet.to_4d()).to_3d()
        ecart = (patte.matrix_world.translation - attendu).length
        assert ecart < 1e-3, f"la patte décroche de son articulation (écart {ecart:.5f})"


def rendre_images(scene, dossier, nom, poser, squelette, instants):
    chemins = []
    for i, t in enumerate(instants):
        controles = poser(t, squelette)
        verifier(squelette, controles)
        chemin = os.path.join(dossier, f"{nom}-{i:02d}.png")
        scene.render.filepath = chemin
        bpy.ops.render.render(write_still=True)
        chemins.append(chemin)
    return chemins


def charger(chemin):
    img = bpy.data.images.load(chemin, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def reduire(px):
    # Moyenne en prémultiplié : pas de liseré sombre sur les bords transparents.
    h, w, _ = px.shape

    def blocs(x):
        return x.reshape(h // ECHELLE, ECHELLE, w // ECHELLE, ECHELLE, x.shape[-1]).mean(axis=(1, 3))

    a = px[..., 3:4]
    pm = blocs(px[..., :3] * a)
    am = blocs(a)
    rgb = np.where(am > 1e-6, pm / np.maximum(am, 1e-6), 0.0)
    return np.concatenate([rgb, am], axis=-1)


def feuille(lignes, sortie, agrandir=1):
    """PNG : chaque liste de chemins devient une bande d'images côte à côte ; les bandes sont empilées
    de haut en bas dans l'ordre donné. Fond transparent, bords lissés."""
    bandes = []
    for ligne in lignes:
        images = [reduire(charger(c)) for c in ligne]
        for im in images:
            assert im.shape == (HAUTEUR, LARGEUR, 4), im.shape
        bandes.append(np.concatenate(images, axis=1))
    # Blender range ses pixels de bas en haut : la première bande doit venir en dernier.
    planche = np.concatenate(bandes[::-1], axis=0)
    if agrandir > 1:
        planche = np.repeat(np.repeat(planche, agrandir, axis=0), agrandir, axis=1)
    img = bpy.data.images.new("planche", width=planche.shape[1], height=planche.shape[0], alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(planche.astype(np.float32).ravel())
    img.filepath_raw = sortie
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return sortie


def ecrire_ts(planches):
    entete = (
        "/**\n"
        " * Les trois pandas de la mascotte — GÉNÉRÉS par scripts/mascotte-panda-3d.py (Blender 5.2, en arrière-plan) :\n"
        " * ne pas éditer à la main. Pour chaque panda, une planche au repos et une au travail : 16 images de\n"
        " * 104 x 125 px côte à côte, en PNG, rejouées en CSS par `steps(16)` (la fenêtre n'admet aucun script).\n"
        " */\n"
    )
    corps = []
    for nom, fichier in planches:
        with open(fichier, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        corps.append(f"export const {nom} =\n  'data:image/png;base64,{b64}'\n")
    os.makedirs(os.path.dirname(SORTIE_TS), exist_ok=True)
    with open(SORTIE_TS, "w", encoding="utf-8", newline="\n") as f:
        f.write(entete + "\n".join(corps))
    return SORTIE_TS


VARIANTES = {
    "panda1": {
        "corps": CORPS_CLASSIQUE,
        "accessoire": None,
        "calme": poser_calme,
        "travail": poser_travail,
        "instants_calme": (0.625, 0.6875, 0.75, 0.8125),
        "instants_travail": (0.0, 0.125, 0.25, 0.375),
    },
    "panda2": {
        "corps": CORPS_CLASSIQUE,
        "accessoire": "bambou",
        "calme": poser_mache,
        "travail": poser_tape,
        "instants_calme": (0.10, 0.26, 0.38, 0.50),
        "instants_travail": (0.0, 0.125, 0.25, 0.375),
    },
    "panda3": {
        "corps": CORPS_RONDI,
        "accessoire": "echarpe",
        "calme": poser_danse,
        "travail": poser_applaudit,
        "instants_calme": (0.0, 0.0625, 0.125, 0.1875),
        "instants_travail": (0.0, 0.125, 0.25, 0.375),
    },
}


def scene_de(variante):
    scene = monde_vide()
    squelette = construire(variante)
    eclairage()
    camera(scene)
    return scene, squelette


def main():
    dossier, controle = options()
    if controle:
        lignes = []
        for vid, variante in VARIANTES.items():
            scene, squelette = scene_de(variante)
            for etat in ("calme", "travail"):
                lignes.append(
                    rendre_images(scene, dossier, f"{vid}-{etat}", variante[etat], squelette, variante["instants_" + etat])
                )
        sortie = feuille(lignes, os.path.join(dossier, "controle-poses.png"), agrandir=2)
        print(f"[panda] feuille de contrôle : {sortie}")
        return
    planches = []
    for vid, variante in VARIANTES.items():
        scene, squelette = scene_de(variante)
        for etat in ("calme", "travail"):
            images = rendre_images(scene, dossier, f"{vid}-{etat}", variante[etat], squelette, INSTANTS)
            planche = feuille([images], os.path.join(dossier, f"planche-{vid}-{etat}.png"))
            planches.append((f"{vid.upper()}_{etat.upper()}", planche))
            print(f"[panda] planche : {planche}")
    sortie = ecrire_ts(planches)
    print(f"[panda] module : {sortie}")


main()
